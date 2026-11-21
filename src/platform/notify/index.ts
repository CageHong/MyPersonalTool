import { ValidationErrorBase } from '../errors'
import { createTelegramChannel } from './telegram'
import type { NotifyChannel, NotifyMessage } from './types'

export { NotifyConfigError, NotifyDeliveryError } from './errors'
export { createTelegramChannel, defaultTelegramConfigPath, loadTelegramConfig } from './telegram'
export type { TelegramChannelOptions, TelegramConfig } from './telegram'
export type { NotifyChannel, NotifyMessage } from './types'

export function formatNotifyMessage(message: NotifyMessage): string {
  if (typeof message === 'string') {
    return message.trim()
  }
  const title = message.title?.trim()
  const body = message.body.trim()
  return title ? `${title}\n${body}` : body
}

export async function sendNotification(
  message: NotifyMessage,
  channel: NotifyChannel = createTelegramChannel(),
): Promise<void> {
  const text = formatNotifyMessage(message)
  if (!text) {
    throw new ValidationErrorBase('Notification message cannot be empty', {
      message: 'required',
    })
  }
  await channel.send(text)
}
