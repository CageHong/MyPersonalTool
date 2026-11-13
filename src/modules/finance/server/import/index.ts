// 對帳單匯入:解析結果(statement-parsers 的輸出)→ 匯入計畫 → 寫入。
//
// planImport 只讀:把每一筆待匯入交易跟帳本比對,分成「新的」與「已經有的」;
// 已經有的再看要不要補對象、來源帳戶那一側的金額有沒有不同。
// applyImport 經過 ledger 寫入:新增「新的」、補對象。金額不同的只在計畫裡列出來,不改。
// 同一份檔案套用兩次,第二次不會再寫任何東西。
import { eq, isNotNull, like, sql } from 'drizzle-orm'
import type { ParseResult, PendingTransaction, SkippedRow } from '@personal-tools/statement-parsers'
import type { FinanceConn } from '../../db/index'
import {
  financeAccounts,
  financeCurrencies,
  financePayees,
  financePostings,
  financeTransactions,
} from '../../db/schema'
import { getAccountsWithLegacyId, getSystemAccounts } from '../ledger/accounts'
import { findPayeeByText, normalizePayeeText, resolvePayee } from '../ledger/payees'
import { createTransaction, setTransactionPayee } from '../ledger/transactions'
import { buildDraft, DraftError } from './draft'
import type { DraftLookups, DraftTransaction } from './draft'

// 來源的帳戶代號 → 帳本帳戶的 legacyId。Wise:'wise:EUR' → 'WISE_EUR'
const SOURCE_ACCOUNT_PREFIX: Record<ParseResult['source'], { code: string; legacy: string }> = {
  wise_csv: { code: 'wise:', legacy: 'WISE_' },
}

export type AccountAmount = { accountId: number; currency: string; amount: number }

export type PlanItem =
  | { status: 'new'; pending: PendingTransaction; draft: DraftTransaction }
  | {
      status: 'existing'
      pending: PendingTransaction
      transactionId: number
      // 要補的對象;不用補是 null
      payeeFix: { from: string; to: string } | null
      // 來源帳戶那一側,帳本現有的金額與檔案算出來的不同;相同是 null
      amountDiff: { existing: AccountAmount[]; incoming: AccountAmount[] } | null
    }

export type ImportPlan = {
  source: ParseResult['source']
  items: PlanItem[]
  skipped: SkippedRow[]
  // 無法轉成分錄的列;有任何一筆就不能套用
  errors: { line: number; externalId: string | null; message: string }[]
  // 帳本裡這個來源的交易,檔案裡沒有的筆數(檔案只涵蓋一段期間時會有)
  missingFromFile: number
}

export type ImportOptions = {
  // 對象文字結尾要去掉的付款處理商後綴
  payeeSuffixes: readonly string[]
}

function sameAmounts(a: AccountAmount[], b: AccountAmount[]): boolean {
  const key = (rows: AccountAmount[]) =>
    rows
      .filter((row) => row.amount !== 0)
      .map((row) => `${row.accountId}:${row.currency}:${row.amount}`)
      .sort()
      .join('|')
  return key(a) === key(b)
}

export function planImport(db: FinanceConn, parsed: ParseResult, options: ImportOptions): ImportPlan {
  const prefix = SOURCE_ACCOUNT_PREFIX[parsed.source]
  const sourceAccounts = new Map(
    getAccountsWithLegacyId(db)
      .filter((account) => account.legacyId.startsWith(prefix.legacy))
      .map((account) => [
        prefix.code + account.legacyId.slice(prefix.legacy.length),
        { id: account.id, currency: account.currency },
      ]),
  )
  const sourceAccountIds = new Set([...sourceAccounts.values()].map((account) => account.id))
  const lookups: DraftLookups = {
    sourceAccounts,
    exponents: new Map(
      db
        .select({ code: financeCurrencies.code, exponent: financeCurrencies.exponent })
        .from(financeCurrencies)
        .all()
        .map((row) => [row.code, row.exponent]),
    ),
    system: getSystemAccounts(db),
  }

  const existingRows = db
    .select({
      id: financeTransactions.id,
      externalId: financeTransactions.externalId,
      source: financeTransactions.source,
      payeeId: financeTransactions.payeeId,
      payeeName: financePayees.name,
    })
    .from(financeTransactions)
    .leftJoin(financePayees, eq(financePayees.id, financeTransactions.payeeId))
    .where(isNotNull(financeTransactions.externalId))
    .all()
  const existingById = new Map(existingRows.map((row) => [row.externalId!, row]))

  // 既有交易在來源帳戶那一側的金額:交易 id → 每個帳戶的合計
  const existingAmounts = new Map<number, AccountAmount[]>()
  const sums = db
    .select({
      transactionId: financePostings.transactionId,
      accountId: financePostings.accountId,
      currency: financePostings.currency,
      amount: sql<number>`SUM(${financePostings.amount})`,
    })
    .from(financePostings)
    .innerJoin(financeAccounts, eq(financeAccounts.id, financePostings.accountId))
    .where(like(financeAccounts.legacyId, `${prefix.legacy}%`))
    .groupBy(financePostings.transactionId, financePostings.accountId, financePostings.currency)
    .all()
  for (const { transactionId, ...amount } of sums) {
    existingAmounts.set(transactionId, [...(existingAmounts.get(transactionId) ?? []), amount])
  }

  const plan: ImportPlan = {
    source: parsed.source,
    items: [],
    skipped: parsed.skipped,
    errors: [],
    missingFromFile: 0,
  }
  const seen = new Set<string>()
  for (const pending of parsed.transactions) {
    const fail = (message: string) =>
      plan.errors.push({ line: pending.line, externalId: pending.externalId, message })
    if (pending.externalId === null) {
      fail('沒有來源 ID,無法判斷是不是已經匯入過')
      continue
    }
    if (seen.has(pending.externalId)) {
      fail(`檔案裡 ID 重複:${pending.externalId}`)
      continue
    }
    seen.add(pending.externalId)

    let draft: DraftTransaction
    try {
      draft = buildDraft(pending, lookups)
    } catch (error) {
      if (!(error instanceof DraftError)) throw error
      fail(error.message)
      continue
    }

    const existing = existingById.get(pending.externalId)
    if (!existing) {
      plan.items.push({ status: 'new', pending, draft })
      continue
    }

    // 補對象:入帳的交易,帳本現在的對象其實是收款的那一方(帳戶持有人自己),而檔案裡有匯款人
    let payeeFix: { from: string; to: string } | null = null
    // 匯款人透過別名對到的收款人就是帳本現在的對象時(例:持有人自己的另一種寫法)不用補
    const holder = pending.raw['Target name'] ?? ''
    const sender = pending.counterparty
    if (
      pending.kind === 'in' &&
      sender !== null &&
      existing.payeeId !== null &&
      existing.payeeId === findPayeeByText(db, holder, options.payeeSuffixes) &&
      existing.payeeId !== findPayeeByText(db, sender, options.payeeSuffixes) &&
      normalizePayeeText(sender, options.payeeSuffixes) !==
        normalizePayeeText(holder, options.payeeSuffixes)
    ) {
      payeeFix = { from: existing.payeeName ?? '', to: sender }
    }

    const incoming = draft.postings
      .filter((posting) => sourceAccountIds.has(posting.accountId))
      .map(({ accountId, currency, amount }) => ({ accountId, currency, amount }))
    const current = existingAmounts.get(existing.id) ?? []
    const amountDiff = sameAmounts(current, incoming) ? null : { existing: current, incoming }

    plan.items.push({ status: 'existing', pending, transactionId: existing.id, payeeFix, amountDiff })
  }

  plan.missingFromFile = existingRows.filter(
    (row) => row.source === parsed.source && !seen.has(row.externalId!),
  ).length
  return plan
}

export type MergeConflict = { externalId: string; lines: { file: number; line: number }[] }

// 同一個來源的多份解析結果合成一份(例:分段匯出、期間重疊的檔案)。
// 同一個 ID 出現在多份檔案:內容相同就留第一份的;內容不同(金額、手續費、對方、時間、種類)列為衝突,
// 兩筆都不留,由使用者決定。不同來源不能合併。
export function mergeParseResults(results: readonly ParseResult[]): {
  merged: ParseResult
  conflicts: MergeConflict[]
} {
  if (!results.length) throw new Error('沒有任何解析結果')
  const source = results[0].source
  if (results.some((result) => result.source !== source)) {
    throw new Error('不同來源的檔案不能一起匯入')
  }
  const signature = (tx: PendingTransaction) =>
    JSON.stringify([tx.kind, tx.occurredAt, tx.movements, tx.fee, tx.counterparty])
  const kept = new Map<string, { tx: PendingTransaction; file: number }>()
  const conflicts = new Map<string, MergeConflict>()
  const withoutId: PendingTransaction[] = []
  results.forEach((result, file) => {
    for (const tx of result.transactions) {
      if (tx.externalId === null) {
        withoutId.push(tx)
        continue
      }
      const conflict = conflicts.get(tx.externalId)
      if (conflict) {
        conflict.lines.push({ file, line: tx.line })
        continue
      }
      const first = kept.get(tx.externalId)
      if (!first) {
        kept.set(tx.externalId, { tx, file })
      } else if (signature(first.tx) !== signature(tx)) {
        kept.delete(tx.externalId)
        conflicts.set(tx.externalId, {
          externalId: tx.externalId,
          lines: [
            { file: first.file, line: first.tx.line },
            { file, line: tx.line },
          ],
        })
      }
    }
  })
  return {
    merged: {
      source,
      transactions: [...[...kept.values()].map((entry) => entry.tx), ...withoutId],
      skipped: results.flatMap((result) => result.skipped),
    },
    conflicts: [...conflicts.values()],
  }
}

export class ImportBlockedError extends Error {
  constructor(public readonly count: number) {
    super(`有 ${count} 列無法轉成分錄,先處理完才能套用`)
    this.name = 'ImportBlockedError'
  }
}

export type ImportOutcome = { created: number; payeesFixed: number }

// 套用計畫。全部包在一個 DB transaction:任何一筆失敗,整份都不寫
export function applyImport(
  db: FinanceConn,
  plan: ImportPlan,
  options: ImportOptions,
  now: string = new Date().toISOString(),
): ImportOutcome {
  if (plan.errors.length) throw new ImportBlockedError(plan.errors.length)
  return db.transaction((tx) => {
    const outcome: ImportOutcome = { created: 0, payeesFixed: 0 }
    for (const item of plan.items) {
      if (item.status === 'new') {
        const { draft } = item
        createTransaction(
          tx,
          {
            occurredAt: draft.occurredAt,
            payeeId: draft.payeeText
              ? resolvePayee(tx, draft.payeeText, options.payeeSuffixes, now)
              : null,
            note: draft.note,
            source: draft.source,
            externalId: draft.externalId,
            importMeta: draft.importMeta,
            postings: draft.postings,
          },
          now,
        )
        outcome.created++
      } else if (item.payeeFix) {
        const payeeId = resolvePayee(tx, item.payeeFix.to, options.payeeSuffixes, now)
        setTransactionPayee(tx, item.transactionId, payeeId, now)
        outcome.payeesFixed++
      }
    }
    return outcome
  })
}
