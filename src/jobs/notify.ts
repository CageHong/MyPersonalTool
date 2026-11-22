import { sendNotification, type NotifyMessage } from '../platform/notify'
import { TOOLS, type ToolId } from '../platform/tools'
import { NOTIFIERS, type ToolNotifier } from './notifiers'

export type NotifyTickSentItem = {
  tool: ToolId
  key: string
}

export type NotifyTickFailure = {
  tool: ToolId
  stage: 'due' | 'send' | 'markSent'
  key?: string
  error: string
}

export type NotifyTickReport = {
  sent: NotifyTickSentItem[]
  failed: NotifyTickFailure[]
}

export type RunNotifyTickOptions = {
  now?: Date
  tools?: readonly { id: ToolId }[]
  notifiers?: Partial<Record<ToolId, ToolNotifier>>
  send?: (message: NotifyMessage) => Promise<void> | void
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runNotifyTick(options: RunNotifyTickOptions = {}): Promise<NotifyTickReport> {
  const {
    now = new Date(),
    tools = TOOLS,
    notifiers = NOTIFIERS,
    send = sendNotification,
  } = options

  const sent: NotifyTickSentItem[] = []
  const failed: NotifyTickFailure[] = []

  for (const tool of tools) {
    const notifier = notifiers[tool.id]
    if (!notifier) {
      continue
    }

    let due
    try {
      due = await notifier.dueNotifications(now)
    } catch (error) {
      failed.push({
        tool: tool.id,
        stage: 'due',
        error: toErrorMessage(error),
      })
      continue
    }

    if (due.length === 0) {
      continue
    }

    const succeededKeys: string[] = []
    for (const item of due) {
      try {
        await send(item.message)
        sent.push({ tool: tool.id, key: item.key })
        succeededKeys.push(item.key)
      } catch (error) {
        failed.push({
          tool: tool.id,
          stage: 'send',
          key: item.key,
          error: toErrorMessage(error),
        })
      }
    }

    if (succeededKeys.length === 0) {
      continue
    }

    try {
      await notifier.markSent(succeededKeys)
    } catch (error) {
      failed.push({
        tool: tool.id,
        stage: 'markSent',
        error: toErrorMessage(error),
      })
    }
  }

  return { sent, failed }
}
