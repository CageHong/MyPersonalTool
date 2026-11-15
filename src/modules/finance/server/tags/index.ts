// tags:標籤(含旅行)。目前只有查詢;標籤的管理在里程碑 b7
import { asc } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import { financeTags } from '../../db/schema'
import type { FinanceLookups } from '../../lib/transactions'

export function listTags(db: FinanceConn): FinanceLookups['tags'] {
  return db
    .select({ id: financeTags.id, name: financeTags.name, startsOn: financeTags.startsOn, endsOn: financeTags.endsOn })
    .from(financeTags)
    .orderBy(asc(financeTags.name))
    .all()
}
