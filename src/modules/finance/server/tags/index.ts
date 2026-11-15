// tags:標籤(含旅行)。標籤本身(finance_tags)的管理在這裡;交易身上的標籤(finance_transaction_tags)
// 的寫入經過 ledger(tagTransactions、moveTagLinks、updateTransaction)。刪除標籤時,交易上的連結由外鍵 cascade 一起刪掉。
// 每個寫入包在一個 DB transaction,並寫入「v2 已停用」
import { asc, eq, sql } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import { financeTags } from '../../db/schema'
import { NAME_MAX_LENGTH } from '../../lib/edit'
import type { TagInput, TagRangeItem, TagRow, TagUpdate } from '../../lib/tags'
import type { FinanceLookups } from '../../lib/transactions'
import { NotFoundError, ValidationError } from '../errors'
import { markV2Retired } from '../ledger/settings'
import { toStoredTimestamp } from '../ledger/time'
import { moveTagLinks, tagTransactions } from '../ledger/transactions'

export function listTags(db: FinanceConn): FinanceLookups['tags'] {
  return db
    .select({ id: financeTags.id, name: financeTags.name, startsOn: financeTags.startsOn, endsOn: financeTags.endsOn })
    .from(financeTags)
    .orderBy(asc(financeTags.name))
    .all()
}

export function listTagsForAdmin(db: FinanceConn): TagRow[] {
  return db.all<TagRow>(sql`
    SELECT g.id, g.name, g.starts_on AS startsOn, g.ends_on AS endsOn,
           (SELECT COUNT(*) FROM finance_transaction_tags tt WHERE tt.tag_id = g.id) AS transactions
    FROM finance_tags g ORDER BY g.name`)
}

function loadTag(tx: FinanceConn, id: number) {
  const [tag] = tx.select().from(financeTags).where(eq(financeTags.id, id)).all()
  if (!tag) throw new NotFoundError('Tag', id)
  return tag
}

// 名稱與日期範圍的檢查;回傳整理過的名稱
function check(
  tx: FinanceConn,
  value: { name: string; startsOn: string | null; endsOn: string | null },
  selfId?: number,
): string {
  const fields: Record<string, string> = {}
  const name = value.name.trim()
  if (name === '') fields.name = 'required'
  else if (name.length > NAME_MAX_LENGTH) fields.name = 'too_long'
  else {
    const [same] = tx.select({ id: financeTags.id }).from(financeTags).where(eq(financeTags.name, name)).all()
    if (same && same.id !== selfId) fields.name = 'duplicate'
  }
  if ((value.startsOn === null) !== (value.endsOn === null)) fields.endsOn = 'range_incomplete'
  else if (value.startsOn && value.endsOn && value.startsOn > value.endsOn) fields.endsOn = 'before_start'
  if (Object.keys(fields).length) throw new ValidationError(fields)
  return name
}

export function createTag(db: FinanceConn, input: TagInput, now: string = new Date().toISOString()): number {
  return db.transaction((tx) => {
    const name = check(tx, input)
    const [{ id }] = tx
      .insert(financeTags)
      .values({ name, startsOn: input.startsOn, endsOn: input.endsOn, createdAt: toStoredTimestamp(now) })
      .returning({ id: financeTags.id })
      .all()
    markV2Retired(tx, toStoredTimestamp(now))
    return id
  })
}

export function updateTag(db: FinanceConn, id: number, patch: TagUpdate, now: string = new Date().toISOString()): void {
  db.transaction((tx) => {
    const tag = loadTag(tx, id)
    const next = {
      name: patch.name ?? tag.name,
      startsOn: patch.startsOn === undefined ? tag.startsOn : patch.startsOn,
      endsOn: patch.endsOn === undefined ? tag.endsOn : patch.endsOn,
    }
    const name = check(tx, next, id)
    tx.update(financeTags).set({ ...next, name }).where(eq(financeTags.id, id)).run()
    markV2Retired(tx, toStoredTimestamp(now))
  })
}

export function deleteTag(db: FinanceConn, id: number, now: string = new Date().toISOString()): void {
  db.transaction((tx) => {
    loadTag(tx, id)
    tx.delete(financeTags).where(eq(financeTags.id, id)).run()
    markV2Retired(tx, toStoredTimestamp(now))
  })
}

// 合併:來源標籤的交易都加上目標標籤,再刪掉來源
export function mergeTag(db: FinanceConn, sourceId: number, targetId: number, now: string = new Date().toISOString()): void {
  db.transaction((tx) => {
    loadTag(tx, sourceId)
    if (sourceId === targetId) throw new ValidationError({ targetId: 'self' })
    const [target] = tx.select({ id: financeTags.id }).from(financeTags).where(eq(financeTags.id, targetId)).all()
    if (!target) throw new ValidationError({ targetId: 'not_found' })
    moveTagLinks(tx, sourceId, targetId, now)
    tx.delete(financeTags).where(eq(financeTags.id, sourceId)).run()
    markV2Retired(tx, toStoredTimestamp(now))
  })
}

// 旅行標籤的日期範圍內、還沒有這個標籤的交易(以 UTC 切日,跟交易清單的日期篩選相同)
export function previewTagRange(db: FinanceConn, id: number): TagRangeItem[] {
  const tag = loadTag(db, id)
  if (!tag.startsOn || !tag.endsOn) throw new ValidationError({ tag: 'no_range' })
  return db.all<TagRangeItem>(sql`
    SELECT t.id AS transactionId, t.occurred_at AS occurredAt, py.name AS payee,
           (SELECT GROUP_CONCAT(a.name, '、') FROM finance_postings p JOIN finance_accounts a ON a.id = p.account_id
            WHERE p.transaction_id = t.id AND a.type IN ('expense', 'income')) AS kind
    FROM finance_transactions t
    LEFT JOIN finance_payees py ON py.id = t.payee_id
    WHERE substr(t.occurred_at, 1, 10) BETWEEN ${tag.startsOn} AND ${tag.endsOn}
      AND NOT EXISTS (SELECT 1 FROM finance_transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = ${id})
    ORDER BY t.occurred_at, t.id`)
}

// 把選中的交易加上這個標籤;不在範圍內的不加
export function applyTagRange(
  db: FinanceConn,
  id: number,
  transactionIds: readonly number[],
  now: string = new Date().toISOString(),
): { applied: number } {
  return db.transaction((tx) => {
    const allowed = new Set(previewTagRange(tx, id).map((item) => item.transactionId))
    const ids = transactionIds.filter((tid) => allowed.has(tid))
    tagTransactions(tx, id, ids, now)
    if (ids.length) markV2Retired(tx, toStoredTimestamp(now))
    return { applied: ids.length }
  })
}
