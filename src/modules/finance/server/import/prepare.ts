// 對帳單匯入的入口:命令列(tools/import-statement.ts)與 API(/api/finance/import/*)都只呼叫這裡,
// 兩邊不各自解析、合併、算計畫,結果才不會不一樣。
//
// prepareImport    檔案文字 → 解析 → 合併 → 匯入計畫(只讀)
// summarizeImport  計畫 → 給人看的摘要(lib/import-summary.ts),含計畫指紋
// previewStatementFiles  上面兩步合起來(試跑)
// applyStatementFiles  重新準備一次 → 指紋相同才備份並套用
//
// 試跑與套用之間不存任何狀態:套用時重送同樣的檔案,伺服器重算計畫;
// 指紋(會被寫入的內容的雜湊)跟試跑時不同,代表帳本在中間變了,不套用。
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { parseStatement, StatementFormatError } from '@personal-tools/statement-parsers'
import type { ParseResult, PendingTransaction } from '@personal-tools/statement-parsers'
import type { ImportResult, ImportSummary } from '../../lib/import-summary'
import { backupDatabase } from '../../db/backup'
import type { FinanceConn } from '../../db/index'
import { ValidationError } from '../errors'
import { applyImport, ImportBlockedError, mergeParseResults, planImport } from './index'
import type { AccountAmount, ImportOptions, ImportPlan, MergeConflict, PlanItem } from './index'

export type StatementFile = { name: string; text: string }

export type PreparedImport = {
  files: { name: string; transactions: number }[]
  parsed: ParseResult
  conflicts: MergeConflict[]
  detailDiffs: MergeConflict[]
  plan: ImportPlan
}

// 檔案本身的問題(認不出來源、缺欄位、不同來源混在一起)。fields.files 是給人看的說明
export class StatementFileError extends ValidationError {
  constructor(message: string) {
    super({ files: message })
    this.message = message
    this.name = 'StatementFileError'
  }
}

export function prepareImport(
  db: FinanceConn,
  files: readonly StatementFile[],
  options: ImportOptions,
): PreparedImport {
  if (!files.length) throw new ValidationError({ files: 'required' })
  const results = files.map((file) => {
    let result: ParseResult | null
    try {
      result = parseStatement(file.text)
    } catch (error) {
      if (error instanceof StatementFormatError) throw new StatementFileError(`${file.name}:${error.message}`)
      throw error
    }
    if (!result) {
      throw new StatementFileError(`${file.name}:認不出這個檔案的來源(目前支援:Wise 交易紀錄 CSV)`)
    }
    return result
  })
  if (results.some((result) => result.source !== results[0].source)) {
    throw new StatementFileError('不同來源的檔案不能一起匯入')
  }
  const { merged, conflicts, detailDiffs } = mergeParseResults(results)
  return {
    files: files.map((file, index) => ({ name: file.name, transactions: results[index].transactions.length })),
    parsed: merged,
    conflicts,
    detailDiffs,
    plan: planImport(db, merged, options),
  }
}

// 會被寫入的內容:新交易(時間、對象、備註、分錄、分類來源、週期項目)與要補的對象。
// 「已經有的」裡金額不同只報告、不寫,不算進來
export function planFingerprint(plan: ImportPlan): string {
  const writes = plan.items.flatMap((item) => {
    if (item.status === 'new') {
      const { draft, classification } = item
      return [
        [
          'new',
          draft.externalId,
          draft.occurredAt,
          draft.payeeText,
          draft.note,
          draft.postings
            .map((p) => `${p.accountId}:${p.currency}:${p.amount}`)
            .sort()
            .join('|'),
          classification.categorySource,
          classification.scheduledId,
        ],
      ]
    }
    return item.status === 'existing' && item.payeeFix ? [['payee', item.transactionId, item.payeeFix.to]] : []
  })
  return createHash('sha256').update(JSON.stringify([plan.source, writes])).digest('hex')
}

export function summarizeImport(db: FinanceConn, prepared: PreparedImport): ImportSummary {
  const { plan, parsed, conflicts, detailDiffs } = prepared
  const accounts = new Map(
    db
      .all<{ id: number; name: string; parent: string | null }>(
        sql`SELECT a.id, a.name, p.name AS parent
            FROM finance_accounts a LEFT JOIN finance_accounts p ON p.id = a.parent_id`,
      )
      .map((row) => [row.id, row]),
  )
  const accountName = (id: number) => accounts.get(id)?.name ?? `#${id}`
  const categoryName = (id: number) => {
    const account = accounts.get(id)
    if (!account) return `#${id}`
    return account.parent ? `${account.parent} › ${account.name}` : account.name
  }
  const exponents = Object.fromEntries(
    db
      .all<{ code: string; exponent: number }>(sql`SELECT code, exponent FROM finance_currencies`)
      .map((row) => [row.code, row.exponent]),
  )
  const money = (rows: AccountAmount[]) =>
    rows.map((row) => ({ account: accountName(row.accountId), currency: row.currency, amount: row.amount }))
  const head = (pending: PendingTransaction) => ({
    externalId: pending.externalId ?? '',
    occurredAt: pending.occurredAt,
  })

  const fresh = plan.items.filter(
    (item): item is Extract<PlanItem, { status: 'new' }> => item.status === 'new',
  )
  const existing = plan.items.filter(
    (item): item is Extract<PlanItem, { status: 'existing' }> => item.status === 'existing',
  )
  const deleted = plan.items.filter((item) => item.status === 'deleted')
  const payeeFixes = existing.filter((item) => item.payeeFix)
  const amountDiffs = existing.filter((item) => item.amountDiff)
  const sourceAccounts = new Set(plan.sourceAccountIds)
  const classifiable = fresh.filter((item) => item.pending.kind !== 'exchange')
  const bySource = (source: string | null) =>
    classifiable.filter((item) => item.classification.categorySource === source).length

  const skipCounts = new Map<string, number>()
  for (const row of plan.skipped) {
    const key = `${row.reason}${row.detail ? `(${row.detail})` : ''}`
    skipCounts.set(key, (skipCounts.get(key) ?? 0) + 1)
  }

  return {
    source: plan.source,
    fingerprint: planFingerprint(plan),
    canApply:
      plan.errors.length === 0 && conflicts.length === 0 && (fresh.length > 0 || payeeFixes.length > 0),
    files: prepared.files,
    counts: {
      transactions: parsed.transactions.length,
      skipped: plan.skipped.length,
      new: fresh.length,
      existing: existing.length,
      payeeFixes: payeeFixes.length,
      amountDiffs: amountDiffs.length,
      incomingKept: existing.filter((item) => item.pending.kind === 'in' && !item.payeeFix).length,
      missingFromFile: plan.missingFromFile,
      deleted: deleted.length,
      errors: plan.errors.length,
      conflicts: conflicts.length,
      detailDiffs: detailDiffs.length,
    },
    classification: {
      scheduled: bySource('scheduled'),
      rule: bySource('rule'),
      payeeHistory: bySource('payee_history'),
      sourceCategory: bySource('source_category'),
      unclassified: bySource(null),
      exchange: fresh.length - classifiable.length,
    },
    exponents,
    skipped: [...skipCounts].map(([reason, count]) => ({ reason, count })),
    conflicts,
    detailDiffs,
    errors: plan.errors,
    payeeFixes: payeeFixes.map((item) => ({ ...head(item.pending), ...item.payeeFix! })),
    amountDiffs: amountDiffs.map((item) => ({
      ...head(item.pending),
      existing: money(item.amountDiff!.existing),
      incoming: money(item.amountDiff!.incoming),
    })),
    targetFees: parsed.transactions
      .filter((tx) => /[1-9]/.test(tx.raw['Target fee amount'] ?? ''))
      .map((tx) => ({
        ...head(tx),
        amount: tx.raw['Target fee amount'] ?? '',
        currency: tx.raw['Target fee currency'] ?? '',
      })),
    ambiguousScheduled: fresh
      .filter((item) => item.classification.ambiguousScheduled.length)
      .map((item) => ({ ...head(item.pending), scheduledIds: item.classification.ambiguousScheduled })),
    newItems: fresh.map((item) => {
      const { accountId, categorySource } = item.classification
      return {
        ...head(item.pending),
        kind: item.pending.kind,
        payee: item.draft.payeeText,
        note: item.draft.note,
        source: money(item.draft.postings.filter((posting) => sourceAccounts.has(posting.accountId))),
        category: item.pending.kind === 'exchange' || accountId === null ? null : categoryName(accountId),
        categorySource,
      }
    }),
  }
}

// 試跑:準備 + 摘要。API 的試跑只呼叫這個
export function previewStatementFiles(
  db: FinanceConn,
  files: readonly StatementFile[],
  options: ImportOptions,
): ImportSummary {
  return summarizeImport(db, prepareImport(db, files, options))
}

export type ApplyOptions = {
  // 試跑時拿到的指紋
  fingerprint: string
  // 套用前把資料庫備份到這裡(每次覆蓋);null = 不備份(測試用)
  backupPath: string | null
}

// 重新準備一次(檔案跟試跑時相同)→ 檢查 → 備份 → 套用。寫入本身在 applyImport 的 DB transaction 裡
export function applyStatementFiles(
  db: FinanceConn,
  files: readonly StatementFile[],
  options: ImportOptions,
  apply: ApplyOptions,
): ImportResult {
  const prepared = prepareImport(db, files, options)
  if (prepared.conflicts.length) throw new ValidationError({ plan: 'conflicts' })
  if (planFingerprint(prepared.plan) !== apply.fingerprint) {
    throw new ValidationError({ fingerprint: 'stale' })
  }
  // applyImport 也會擋;先檢查,免得白做一次備份
  if (prepared.plan.errors.length) throw new ImportBlockedError(prepared.plan.errors.length)
  if (apply.backupPath) backupDatabase(db, apply.backupPath)
  const outcome = applyImport(db, prepared.plan, options)
  return { ...outcome, backupPath: apply.backupPath }
}
