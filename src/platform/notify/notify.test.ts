import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ValidationErrorBase } from '../errors'
import {
  createTelegramChannel,
  loadTelegramConfig,
  NotifyConfigError,
  NotifyDeliveryError,
  sendNotification,
} from './index'

const FAKE_TOKEN = '000000:TEST_FAKE_BOT_TOKEN_XYZ'
const FAKE_CHAT_ID = '999000111'

function withTempDir(run: (dir: string) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), 'notify-test-'))
  try {
    const result = run(dir)
    if (result instanceof Promise) {
      return result.finally(() => rmSync(dir, { recursive: true, force: true }))
    }
    rmSync(dir, { recursive: true, force: true })
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

describe('platform/notify', () => {
  it('sends notification successfully via Telegram channel', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const channel = createTelegramChannel({
      config: { botToken: FAKE_TOKEN, chatId: FAKE_CHAT_ID },
      fetch: fakeFetch,
    })

    await sendNotification({ title: 'Reminder', body: 'Water plants' }, channel)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`)
    assert.equal(calls[0].init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      chat_id: FAKE_CHAT_ID,
      text: 'Reminder\nWater plants',
    })
  })

  it('throws NotifyDeliveryError without leaking token when Telegram returns an error', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          ok: false,
          description: `Bad Request: chat not found for ${FAKE_TOKEN}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )

    const channel = createTelegramChannel({
      config: { botToken: FAKE_TOKEN, chatId: FAKE_CHAT_ID },
      fetch: fakeFetch,
    })

    await assert.rejects(
      () => sendNotification('hello', channel),
      (err: unknown) => {
        assert.ok(err instanceof NotifyDeliveryError)
        assert.equal(err.channel, 'telegram')
        assert.equal(err.status, 400)
        assert.ok(!err.message.includes(FAKE_TOKEN))
        return true
      },
    )
  })

  it('throws NotifyDeliveryError without leaking token when fetch rejects', async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new Error(`request to https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage failed`)
    }

    const channel = createTelegramChannel({
      config: { botToken: FAKE_TOKEN, chatId: FAKE_CHAT_ID },
      fetch: fakeFetch,
    })

    await assert.rejects(
      () => sendNotification('hello', channel),
      (err: unknown) => {
        assert.ok(err instanceof NotifyDeliveryError)
        assert.ok(!err.message.includes(FAKE_TOKEN))
        return true
      },
    )
  })

  it('throws NotifyConfigError with file path when config file is missing', () =>
    withTempDir((dir) => {
      const missingPath = join(dir, 'notify', 'telegram.json')
      assert.throws(
        () => loadTelegramConfig(missingPath),
        (err: unknown) => {
          assert.ok(err instanceof ValidationErrorBase)
          assert.ok(err instanceof NotifyConfigError)
          assert.ok(err.message.includes(missingPath))
          assert.equal(err.fields.config, 'missing')
          return true
        },
      )
    }))

  it('throws NotifyConfigError with file path and without token when required fields are missing', () =>
    withTempDir((dir) => {
      const configPath = join(dir, 'telegram.json')
      writeFileSync(configPath, JSON.stringify({ botToken: FAKE_TOKEN }), 'utf8')

      assert.throws(
        () => loadTelegramConfig(configPath),
        (err: unknown) => {
          assert.ok(err instanceof ValidationErrorBase)
          assert.ok(err instanceof NotifyConfigError)
          assert.ok(err.message.includes(configPath))
          assert.ok(!err.message.includes(FAKE_TOKEN))
          assert.equal(err.fields.chatId, 'required')
          return true
        },
      )
    }))

  it('throws NotifyConfigError when botToken is missing', () =>
    withTempDir((dir) => {
      const configPath = join(dir, 'telegram.json')
      writeFileSync(configPath, JSON.stringify({ chatId: 123456 }), 'utf8')

      assert.throws(
        () => loadTelegramConfig(configPath),
        (err: unknown) => {
          assert.ok(err instanceof NotifyConfigError)
          assert.ok(err.message.includes(configPath))
          assert.equal(err.fields.botToken, 'required')
          return true
        },
      )
    }))

  it('rejects empty notification message', async () => {
    const channel = createTelegramChannel({
      config: { botToken: FAKE_TOKEN, chatId: FAKE_CHAT_ID },
      fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    })

    await assert.rejects(
      () => sendNotification('   ', channel),
      (err: unknown) => err instanceof ValidationErrorBase && err.fields.message === 'required',
    )
  })
})
