// 清理「錯過就跳過」上線前的既有實例（decisions §6a）:migration 把它們標成 edited_at = 0(是否編輯過未知)。
// 推斷為沒編輯過的:已錯過的刪除;還沒錯過的(上線當天的)改回 null,之後照一般規則跳過。
// 推斷為編輯過的維持 0,不動。預設只列出不寫入;加 --apply 才在一個 transaction 裡寫入。
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db'
import {
  task,
  taskChecklistItem,
  taskRecurrenceRule,
  taskRecurrenceRuleChecklistItem,
} from '../db/schema'
import { todayIso } from '../lib/date'
import { looksEdited, type LegacyRule } from '../server/missedInstances'

export type LegacyMissedTarget = {
  id: number
  // delete:已錯過,刪除;reset:還沒錯過,edited_at 改回 null
  action: 'delete' | 'reset'
  ruleTitle: string
  occurrenceDate: string
  dueDate: string | null
}

export function skipLegacyMissedInstances(
  today: string,
  options: { apply: boolean },
): LegacyMissedTarget[] {
  return db.transaction((tx) => {
    const rows = tx
      .select({
        taskId: task.id,
        title: task.title,
        notes: task.notes,
        priority: task.priority,
        dueDate: task.dueDate,
        occurrenceDate: task.occurrenceDate,
        createdAt: task.createdAt,
        ruleId: taskRecurrenceRule.id,
        ruleTitle: taskRecurrenceRule.title,
        ruleNotes: taskRecurrenceRule.notes,
        rulePriority: taskRecurrenceRule.priority,
        ruleCreatedAt: taskRecurrenceRule.createdAt,
      })
      .from(task)
      .innerJoin(taskRecurrenceRule, eq(task.recurrenceRuleId, taskRecurrenceRule.id))
      .where(
        and(
          eq(task.editedAt, 0),
          isNull(taskRecurrenceRule.endedAt),
          isNull(task.completedAt),
        ),
      )
      .orderBy(asc(task.occurrenceDate), asc(task.id))
      .all()

    const ruleCache = new Map<number, LegacyRule>()
    const targets: LegacyMissedTarget[] = []

    for (const row of rows) {
      if (row.occurrenceDate === null) {
        continue
      }
      let rule = ruleCache.get(row.ruleId)
      if (!rule) {
        const templateItems = tx
          .select({ title: taskRecurrenceRuleChecklistItem.title })
          .from(taskRecurrenceRuleChecklistItem)
          .where(eq(taskRecurrenceRuleChecklistItem.ruleId, row.ruleId))
          .orderBy(asc(taskRecurrenceRuleChecklistItem.position), asc(taskRecurrenceRuleChecklistItem.id))
          .all()
        rule = {
          title: row.ruleTitle,
          notes: row.ruleNotes,
          priority: row.rulePriority,
          createdAt: row.ruleCreatedAt,
          template: templateItems.map((item) => item.title),
        }
        ruleCache.set(row.ruleId, rule)
      }

      const checklist = tx
        .select({
          title: taskChecklistItem.title,
          completedAt: taskChecklistItem.completedAt,
        })
        .from(taskChecklistItem)
        .where(eq(taskChecklistItem.taskId, row.taskId))
        .orderBy(asc(taskChecklistItem.position), asc(taskChecklistItem.id))
        .all()

      const edited = looksEdited(
        {
          title: row.title,
          notes: row.notes,
          priority: row.priority,
          dueDate: row.dueDate,
          occurrenceDate: row.occurrenceDate,
          createdAt: row.createdAt,
          checklist,
        },
        rule,
      )

      if (!edited) {
        const missed =
          row.occurrenceDate < today && row.dueDate !== null && row.dueDate < today
        targets.push({
          id: row.taskId,
          action: missed ? 'delete' : 'reset',
          ruleTitle: row.ruleTitle,
          occurrenceDate: row.occurrenceDate,
          dueDate: row.dueDate,
        })
      }
    }

    const deleteIds = targets.filter((target) => target.action === 'delete').map((target) => target.id)
    const resetIds = targets.filter((target) => target.action === 'reset').map((target) => target.id)
    if (options.apply && deleteIds.length > 0) {
      tx.delete(task).where(inArray(task.id, deleteIds)).run()
    }
    if (options.apply && resetIds.length > 0) {
      tx.update(task).set({ editedAt: null }).where(inArray(task.id, resetIds)).run()
    }

    return targets
  })
}

const isMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  const apply = process.argv.includes('--apply')
  const today = todayIso()
  const targets = skipLegacyMissedInstances(today, { apply })
  if (targets.length === 0) {
    console.log('沒有需要清理的舊逾期重複實例。')
  } else {
    for (const target of targets) {
      const label = target.action === 'delete' ? '刪除' : '改回一般'
      console.log(`${label}\t#${target.id}\t${target.occurrenceDate}\t${target.ruleTitle}`)
    }
    const deleteCount = targets.filter((target) => target.action === 'delete').length
    const resetCount = targets.length - deleteCount
    console.log(
      apply
        ? `✓ 已刪除 ${deleteCount} 筆、改回一般 ${resetCount} 筆。`
        : `刪除 ${deleteCount} 筆、改回一般 ${resetCount} 筆(預覽模式未寫入;加 --apply 才寫入)。`,
    )
  }
  db.$client.close()
}
