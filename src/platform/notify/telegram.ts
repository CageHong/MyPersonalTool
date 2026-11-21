import { readFileSync } from 'node:fs'
import { toolDataPath } from '../dataDir'
import { NotifyConfigError, NotifyDeliveryError } from './errors'
import type { NotifyChannel } from './types'

export type TelegramConfig = {
  botToken: string
  chatId: string
}

export type TelegramChannelOptions = {
  configPath?: string
  config?: TelegramConfig
  fetch?: typeof fetch
}

export function defaultTelegramConfigPath(): string {
  return toolDataPath('notify', 'telegram.json')
}

function redactToken(text: string, token: string): string {
  return token ? text.split(token).join('[REDACTED]') : text
}

export function loadTelegramConfig(configPath = defaultTelegramConfigPath()): TelegramConfig {
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : undefined
    if (code === 'ENOENT') {
      throw new NotifyConfigError(`Telegram config file not found: ${configPath}`, {
        config: 'missing',
      })
    }
    throw new NotifyConfigError(`Failed to read Telegram config file: ${configPath}`, {
      config: 'unreadable',
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new NotifyConfigError(`Invalid JSON in Telegram config file: ${configPath}`, {
      config: 'invalid_json',
    })
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NotifyConfigError(`Telegram config must be a JSON object: ${configPath}`, {
      config: 'invalid_type',
    })
  }

  const record = parsed as Record<string, unknown>
  const fields: Record<string, string> = {}

  const botToken = typeof record.botToken === 'string' ? record.botToken.trim() : ''
  if (!botToken) {
    fields.botToken = 'required'
  }

  const rawChatId = record.chatId
  const chatId =
    typeof rawChatId === 'string'
      ? rawChatId.trim()
      : typeof rawChatId === 'number' && Number.isFinite(rawChatId)
        ? String(rawChatId)
        : ''
  if (!chatId) {
    fields.chatId = 'required'
  }

  if (Object.keys(fields).length > 0) {
    const missing = Object.keys(fields).join(', ')
    throw new NotifyConfigError(`Missing required Telegram config fields (${missing}) in: ${configPath}`, fields)
  }

  return { botToken, chatId }
}

export function createTelegramChannel(options: TelegramChannelOptions = {}): NotifyChannel {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const configPath = options.configPath ?? defaultTelegramConfigPath()

  return {
    name: 'telegram',
    async send(text: string): Promise<void> {
      const config = options.config ?? loadTelegramConfig(configPath)
      const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`

      let res: Response
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: config.chatId,
            text,
          }),
        })
      } catch (err) {
        const reason = err instanceof Error ? redactToken(err.message, config.botToken) : 'network error'
        throw new NotifyDeliveryError('telegram', `Telegram request failed: ${reason}`)
      }

      let payload: { ok?: boolean; description?: string } | null = null
      try {
        payload = (await res.json()) as { ok?: boolean; description?: string }
      } catch {
        payload = null
      }

      if (!res.ok || payload?.ok === false) {
        const detail = payload?.description ?? res.statusText ?? 'unknown error'
        throw new NotifyDeliveryError(
          'telegram',
          `Telegram API error (${res.status}): ${redactToken(detail, config.botToken)}`,
          res.status,
        )
      }
    },
  }
}
