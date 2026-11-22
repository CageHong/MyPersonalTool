import type { NotifyMessage } from '../platform/notify'
import type { ToolId } from '../platform/tools'

export type DueNotification = {
  key: string
  message: NotifyMessage
}

export type ToolNotifier = {
  dueNotifications(now: Date): DueNotification[] | Promise<DueNotification[]>
  markSent(keys: string[]): void | Promise<void>
}

export const NOTIFIERS: Partial<Record<ToolId, ToolNotifier>> = {
  tasks: {
    async dueNotifications(now) {
      const { dueTaskNotifications } = await import('../modules/tasks/server/notifications')
      return dueTaskNotifications(now)
    },
    async markSent(keys) {
      const { markTaskNotificationsSent } = await import('../modules/tasks/server/notifications')
      markTaskNotificationsSent(keys)
    },
  },
}
