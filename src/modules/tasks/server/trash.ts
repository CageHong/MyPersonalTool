import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { db } from '../db'
import { task } from '../db/schema'
import { NotFoundError } from './errors'
import type { Task } from './tasks'

// 垃圾桶清單:只列已軟刪除的任務,最近刪除的在前,同秒以 id 降冪打破平手(decisions §6h)
export function listTrash(): Task[] {
  return db
    .select()
    .from(task)
    .where(isNotNull(task.deletedAt))
    .orderBy(desc(task.deletedAt), desc(task.id))
    .all()
}

export function restoreTask(id: number): Task {
  const [restored] = db
    .update(task)
    .set({ deletedAt: null })
    .where(and(eq(task.id, id), isNotNull(task.deletedAt)))
    .returning()
    .all()
  if (!restored) {
    throw new NotFoundError(id)
  }
  return restored
}

// 永久刪除:只作用在垃圾桶內的任務;checklist 與提醒依外鍵 cascade 一起刪
export function purgeTask(id: number): void {
  const [purged] = db
    .delete(task)
    .where(and(eq(task.id, id), isNotNull(task.deletedAt)))
    .returning({ id: task.id })
    .all()
  if (!purged) {
    throw new NotFoundError(id)
  }
}

export function emptyTrash(): number {
  const purged = db
    .delete(task)
    .where(isNotNull(task.deletedAt))
    .returning({ id: task.id })
    .all()
  return purged.length
}
