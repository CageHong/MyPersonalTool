import { and, asc, eq, gt, isNull, lt, lte } from 'drizzle-orm'
import { db } from '../db'
import { task, taskChecklistItem, taskRecurrenceRule, taskRecurrenceRuleChecklistItem, taskReminder } from '../db/schema'
import { addDaysUtc, expandRule, firstOccurrence, FREQS, type Freq, type RecurrenceSpec } from '../lib/recurrence'
import { NotFoundError, ValidationError } from './errors'
import { isCalendarDate, PRIORITY_VALUES } from './validation'

export type RecurrenceRule = typeof taskRecurrenceRule.$inferSelect

// API 回傳的規則:欄位加上範本 checklist 的標題(依 position、id)
export type RecurrenceRuleDetail = RecurrenceRule & { checklist: string[] }

// 所有用到「今天」的函式都由參數接收 today(YYYY-MM-DD),不在這裡讀時鐘;
// 絕對時刻(createdAt、updatedAt、endedAt)照其他模組的慣例用 now()

export type RuleSpecInput = {
  freq: Freq
  interval: number
  weekdays?: number | null
  startDate: string
  // 結束日,含當天;不給或 null = 永不結束
  until?: string | null
}

// key 不存在 = 不改。checklist 給了就整份取代範本
export type UpdateRuleChanges = {
  freq?: Freq
  interval?: number
  weekdays?: number | null
  startDate?: string
  // 同 weekdays:key 出現才變更,null = 改回永不結束
  until?: string | null
  title?: string
  notes?: string | null
  priority?: number | null
  excludeFromSummary?: boolean
  checklist?: string[]
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// 補齊終點 = 今天 + 6(含),對上「未來 7 天」檢視的邊界
const FILL_AHEAD_DAYS = 6

function now(): number {
  return Math.floor(Date.now() / 1000)
}

// 在這裡擋掉,不讓資料庫的 CHECK 失敗變成 500
function collectSpecErrors(spec: Partial<RuleSpecInput>): Record<string, string> {
  const fields: Record<string, string> = {}
  if (!FREQS.includes(spec.freq as Freq)) {
    fields.freq = 'invalid_value'
  }
  if (!Number.isInteger(spec.interval) || (spec.interval as number) < 1) {
    fields.interval = 'invalid_value'
  }
  const weekdays = spec.weekdays ?? null
  if (spec.freq === 'weekly') {
    if (!Number.isInteger(weekdays) || (weekdays as number) < 1 || (weekdays as number) > 127) {
      fields.weekdays = 'invalid_value'
    }
  } else if (weekdays !== null) {
    fields.weekdays = 'invalid_value'
  }
  if (!isCalendarDate(spec.startDate)) {
    fields.startDate = 'invalid_format'
  }
  // 允許早於今天:等同已到期,不產生新實例;限制的話修改歷史規則會變難
  const until = spec.until ?? null
  if (until !== null) {
    if (!isCalendarDate(until)) {
      fields.until = 'invalid_format'
    } else if (fields.startDate === undefined && until < (spec.startDate as string)) {
      fields.until = 'before_start'
    }
  }
  return fields
}

function toSpec(rule: RecurrenceRule): RecurrenceSpec {
  return {
    freq: rule.freq,
    interval: rule.interval,
    weekdays: rule.weekdays,
    startDate: rule.startDate,
    until: rule.until,
  }
}

function selectRule(executor: typeof db | Tx, ruleId: number): RecurrenceRule {
  const [found] = executor
    .select()
    .from(taskRecurrenceRule)
    .where(eq(taskRecurrenceRule.id, ruleId))
    .limit(1)
    .all()
  if (!found) {
    throw new NotFoundError(ruleId)
  }
  return found
}

function selectTemplateTitles(executor: typeof db | Tx, ruleId: number): string[] {
  return executor
    .select({ title: taskRecurrenceRuleChecklistItem.title })
    .from(taskRecurrenceRuleChecklistItem)
    .where(eq(taskRecurrenceRuleChecklistItem.ruleId, ruleId))
    // position 不保證唯一,id 打破平手
    .orderBy(asc(taskRecurrenceRuleChecklistItem.position), asc(taskRecurrenceRuleChecklistItem.id))
    .all()
    .map((item) => item.title)
}

function selectRuleDetail(executor: typeof db | Tx, ruleId: number): RecurrenceRuleDetail {
  return { ...selectRule(executor, ruleId), checklist: selectTemplateTitles(executor, ruleId) }
}

function insertTemplate(tx: Tx, ruleId: number, titles: string[]): void {
  const timestamp = now()
  titles.forEach((title, position) => {
    tx.insert(taskRecurrenceRuleChecklistItem)
      .values({ ruleId, title, position, createdAt: timestamp, updatedAt: timestamp })
      .run()
  })
}

// 改規則與停止重複共用的邊界:只動今天之後、未完成的實例。
// 今天的、逾期的、已完成的都是已經發生的紀錄,不被規則變更改寫。checklist 隨 cascade 刪除
function deleteFutureIncomplete(tx: Tx, ruleId: number, today: string): void {
  tx.delete(task)
    .where(
      and(
        eq(task.recurrenceRuleId, ruleId),
        gt(task.occurrenceDate, today),
        isNull(task.completedAt),
      ),
    )
    .run()
}

// 錯過就跳過（decisions §6a）：刪掉未完成、occurrenceDate 與 dueDate 都早於今天、且未編輯過的實例（checklist 依 cascade 一起刪）
function deleteMissedUntouched(tx: Tx, ruleId: number, today: string): void {
  tx.delete(task)
    .where(
      and(
        eq(task.recurrenceRuleId, ruleId),
        isNull(task.completedAt),
        lt(task.occurrenceDate, today),
        lt(task.dueDate, today),
        isNull(task.editedAt),
      ),
    )
    .run()
}

// 先清除錯過的未編輯實例，再從水位線下一天（不早於今天）補到終點。水位線只前進不後退
function fillRule(tx: Tx, rule: RecurrenceRule, today: string): void {
  deleteMissedUntouched(tx, rule.id, today)

  const end = addDaysUtc(today, FILL_AHEAD_DAYS)
  const nextFrom = rule.generatedThrough === null ? rule.startDate : addDaysUtc(rule.generatedThrough, 1)
  const from = nextFrom < today ? today : nextFrom
  if (from > end) {
    return
  }

  const templateTitles = selectTemplateTitles(tx, rule.id)
  for (const date of expandRule(toSpec(rule), from, end)) {
    // 欄位填法同 createTask;時間類欄位規則還沒有,留 null
    const [created] = tx
      .insert(task)
      .values({
        title: rule.title,
        notes: rule.notes,
        dueDate: date,
        dueTime: null,
        scheduledAt: null,
        durationMinutes: null,
        priority: rule.priority,
        excludeFromSummary: rule.excludeFromSummary,
        completedAt: null,
        createdAt: now(),
        parentTaskId: null,
        recurrenceRuleId: rule.id,
        occurrenceDate: date,
        editedAt: null,
      })
      // 唯一鍵 (recurrenceRuleId, occurrenceDate) 擋掉已存在的實例(如改規則後留下的已完成實例)
      .onConflictDoNothing()
      .returning({ id: task.id })
      .all()
    if (!created) {
      continue
    }

    const timestamp = now()
    templateTitles.forEach((title, position) => {
      tx.insert(taskChecklistItem)
        .values({
          taskId: created.id,
          title,
          position,
          completedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run()
    })
  }

  // 水位線是簿記,不是規則內容,不動 updatedAt
  tx.update(taskRecurrenceRule)
    .set({ generatedThrough: end })
    .where(eq(taskRecurrenceRule.id, rule.id))
    .run()
}

// 把既有任務變成重複規則的第一個實例。任務的 title、notes、priority 與 checklist 標題成為範本;
// dueTime、scheduledAt、durationMinutes 不進範本(規則還沒有時間欄位)
export function createRuleFromTask(
  taskId: number,
  spec: RuleSpecInput,
  today: string,
): RecurrenceRuleDetail {
  const fields = collectSpecErrors(spec)
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields)
  }
  const normalizedSpec: RecurrenceSpec = {
    freq: spec.freq,
    interval: spec.interval,
    weekdays: spec.weekdays ?? null,
    startDate: spec.startDate,
    until: spec.until ?? null,
  }

  return db.transaction((tx) => {
    const [source] = tx.select().from(task).where(eq(task.id, taskId)).limit(1).all()
    if (!source) {
      throw new NotFoundError(taskId)
    }
    // 停止重複可逆:舊規則已停止時可以建新規則,任務改指向新規則;
    // 舊規則與它的其他實例不動,是紀錄。還在進行中的規則才拒絕
    if (source.recurrenceRuleId !== null && selectRule(tx, source.recurrenceRuleId).endedAt === null) {
      throw new ValidationError({ recurrenceRuleId: 'already_set' })
    }
    if (source.completedAt !== null) {
      throw new ValidationError({ taskId: 'completed' })
    }
    // scheduledAt 是含日期的絕對時刻,截止日改到第一個日期後會和它矛盾;先拒絕,之後再定平移規則
    if (source.scheduledAt !== null) {
      throw new ValidationError({ scheduledAt: 'set' })
    }

    const first = firstOccurrence(normalizedSpec)
    // 原任務會成為 first 那天的實例;until 早於它的話規則一個實例都沒有。寫入前擋掉
    if (normalizedSpec.until !== null && normalizedSpec.until < first) {
      throw new ValidationError({ until: 'before_start' })
    }
    const yesterday = addDaysUtc(today, -1)
    const timestamp = now()
    const [rule] = tx
      .insert(taskRecurrenceRule)
      .values({
        ...normalizedSpec,
        title: source.title,
        notes: source.notes,
        priority: source.priority,
        excludeFromSummary: source.excludeFromSummary,
        // 原任務就是 first 那天的實例,補齊從隔天開始。
        // 不回溯:first 在過去時從今天開始補,規則建立前的日期沒有被錯過,不產生實例
        generatedThrough: first > yesterday ? first : yesterday,
        endedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()
      .all()

    const sourceItems = tx
      .select({ title: taskChecklistItem.title })
      .from(taskChecklistItem)
      .where(eq(taskChecklistItem.taskId, taskId))
      .orderBy(asc(taskChecklistItem.position), asc(taskChecklistItem.id))
      .all()
    insertTemplate(
      tx,
      rule.id,
      sourceItems.map((item) => item.title),
    )

    tx.update(task)
      .set({ recurrenceRuleId: rule.id, occurrenceDate: first, dueDate: first, editedAt: timestamp })
      .where(eq(task.id, taskId))
      .run()

    // 相對提醒(daysBefore <= 6)搬到規則上成為範本;絕對提醒與 daysBefore > 6 的留在原任務
    tx.update(taskReminder)
      .set({ taskId: null, ruleId: rule.id, updatedAt: timestamp })
      .where(
        and(
          eq(taskReminder.taskId, taskId),
          eq(taskReminder.kind, 'relative'),
          lte(taskReminder.daysBefore, 6),
        ),
      )
      .run()

    fillRule(tx, rule, today)
    return selectRuleDetail(tx, rule.id)
  })
}

// 讀取時補齊:每條進行中的規則各自一個 transaction,一條失敗不影響其他條已補好的
export function fillInstances(today: string): void {
  const rules = db
    .select()
    .from(taskRecurrenceRule)
    .where(isNull(taskRecurrenceRule.endedAt))
    .all()
  for (const rule of rules) {
    db.transaction((tx) => fillRule(tx, rule, today))
  }
}

export function updateRule(
  ruleId: number,
  changes: UpdateRuleChanges,
  today: string,
): RecurrenceRuleDetail {
  const fields: Record<string, string> = {}
  if (changes.title !== undefined && (typeof changes.title !== 'string' || changes.title.trim() === '')) {
    fields.title = 'required'
  }
  if (changes.notes != null && typeof changes.notes !== 'string') {
    fields.notes = 'invalid_value'
  }
  if (changes.priority != null && !PRIORITY_VALUES.includes(changes.priority)) {
    fields.priority = 'invalid_value'
  }
  if (changes.excludeFromSummary !== undefined && typeof changes.excludeFromSummary !== 'boolean') {
    fields.excludeFromSummary = 'invalid_value'
  }
  if (
    changes.checklist !== undefined &&
    !(
      Array.isArray(changes.checklist) &&
      changes.checklist.every((title) => typeof title === 'string' && title.trim() !== '')
    )
  ) {
    fields.checklist = 'invalid_value'
  }
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields)
  }

  return db.transaction((tx) => {
    const existing = selectRule(tx, ruleId)
    if (existing.endedAt !== null) {
      throw new ValidationError({ ruleId: 'ended' })
    }

    // 先用舊規則補到今天 + 6:水位線落後的那段是舊規則下逾期與今天的實例,
    // 照「錯過全部補出」必須存在,不能被後面的 generatedThrough = today 跳過
    fillRule(tx, existing, today)

    // 與現值合併後整體驗證:改成非 weekly 時,呼叫端要一併送 weekdays: null
    const merged = {
      freq: changes.freq ?? existing.freq,
      interval: changes.interval ?? existing.interval,
      weekdays: 'weekdays' in changes ? (changes.weekdays ?? null) : existing.weekdays,
      startDate: changes.startDate ?? existing.startDate,
      until: 'until' in changes ? (changes.until ?? null) : existing.until,
      title: changes.title !== undefined ? changes.title.trim() : existing.title,
      notes: 'notes' in changes ? (changes.notes ?? null) : existing.notes,
      // 欄位是 NOT NULL DEFAULT 0,null 在這裡正規化成 0
      priority: 'priority' in changes ? (changes.priority ?? 0) : existing.priority,
      excludeFromSummary:
        changes.excludeFromSummary !== undefined ? changes.excludeFromSummary : existing.excludeFromSummary,
    }
    const specFields = collectSpecErrors(merged)
    if (Object.keys(specFields).length > 0) {
      throw new ValidationError(specFields)
    }

    const currentTemplate = selectTemplateTitles(tx, ruleId)
    const nextTemplate = changes.checklist?.map((title) => title.trim())
    const templateChanged =
      nextTemplate !== undefined &&
      (nextTemplate.length !== currentTemplate.length ||
        nextTemplate.some((title, i) => title !== currentTemplate[i]))
    const ruleChanged = (Object.keys(merged) as (keyof typeof merged)[]).some(
      (key) => merged[key] !== existing[key],
    )

    // 沒有實際變化就不重生實例(上面的補齊照常保留)
    if (!ruleChanged && !templateChanged) {
      return selectRuleDetail(tx, ruleId)
    }

    tx.update(taskRecurrenceRule)
      .set({ ...merged, updatedAt: now() })
      .where(eq(taskRecurrenceRule.id, ruleId))
      .run()
    if (nextTemplate !== undefined && templateChanged) {
      tx.delete(taskRecurrenceRuleChecklistItem)
        .where(eq(taskRecurrenceRuleChecklistItem.ruleId, ruleId))
        .run()
      insertTemplate(tx, ruleId, nextTemplate)
    }

    deleteFutureIncomplete(tx, ruleId, today)
    // 從明天起用新規則重新產生;今天的實例屬於舊規則,不補(見 decisions §8)
    tx.update(taskRecurrenceRule)
      .set({ generatedThrough: today })
      .where(eq(taskRecurrenceRule.id, ruleId))
      .run()
    fillRule(tx, selectRule(tx, ruleId), today)

    return selectRuleDetail(tx, ruleId)
  })
}

// 冪等:已停止的規則原樣回傳,不寫入
export function stopRule(ruleId: number, today: string): RecurrenceRuleDetail {
  return db.transaction((tx) => {
    const existing = selectRule(tx, ruleId)
    if (existing.endedAt !== null) {
      return selectRuleDetail(tx, ruleId)
    }

    // 同 updateRule:先把落後的那段用現在的規則補出來
    fillRule(tx, existing, today)

    const timestamp = now()
    tx.update(taskRecurrenceRule)
      .set({ endedAt: timestamp, updatedAt: timestamp })
      .where(eq(taskRecurrenceRule.id, ruleId))
      .run()
    deleteFutureIncomplete(tx, ruleId, today)

    return selectRuleDetail(tx, ruleId)
  })
}

// 已停止的規則照樣回傳(endedAt 有值)
export function getRule(ruleId: number): RecurrenceRuleDetail {
  return selectRuleDetail(db, ruleId)
}
