// 主線寫的規格測試(docs/ag-cards/notify-runner.md)。不要為了通過而改這支測試。
// runner 一個 tick 的行為:docs/platform/decisions.md §8「runner」。
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { NotifyMessage } from '../platform/notify'
import type { ToolId } from '../platform/tools'
import type { DueNotification, ToolNotifier } from './notifiers'
import { runNotifyTick } from './notify'

const NOW = new Date(2026, 8, 19, 8, 5)

type FakeNotifier = ToolNotifier & {
  dueCalls: Date[]
  markSentCalls: string[][]
}

function fakeNotifier(due: DueNotification[] | (() => DueNotification[])): FakeNotifier {
  const fake: FakeNotifier = {
    dueCalls: [],
    markSentCalls: [],
    dueNotifications(now) {
      fake.dueCalls.push(now)
      return typeof due === 'function' ? due() : due
    },
    markSent(keys) {
      fake.markSentCalls.push([...keys])
    },
  }
  return fake
}

function textOf(message: NotifyMessage): string {
  return typeof message === 'string' ? message : message.body
}

// 收下所有訊息;body 列在 failOn 裡的丟錯,模擬那則送失敗
function fakeSend(failOn: string[] = []) {
  const sent: string[] = []
  const send = async (message: NotifyMessage) => {
    const text = textOf(message)
    if (failOn.includes(text)) {
      throw new Error(`network down: ${text}`)
    }
    sent.push(text)
  }
  return { sent, send }
}

const TOOLS: { id: ToolId }[] = [{ id: 'tasks' }, { id: 'finance' }]

describe('runNotifyTick', () => {
  test('把 now 交給每個工具的 dueNotifications', async () => {
    const tasks = fakeNotifier([])
    const finance = fakeNotifier([])
    await runNotifyTick({ now: NOW, tools: TOOLS, notifiers: { tasks, finance }, send: fakeSend().send })
    assert.deepEqual(tasks.dueCalls, [NOW])
    assert.deepEqual(finance.dueCalls, [NOW])
  })

  test('逐則送出,送完後用送成功的 key 呼叫一次 markSent', async () => {
    const tasks = fakeNotifier([
      { key: 'k-a', message: 'alpha' },
      { key: 'k-b', message: { title: 'T', body: 'beta' } },
    ])
    const { sent, send } = fakeSend()
    const report = await runNotifyTick({ now: NOW, tools: TOOLS, notifiers: { tasks }, send })

    assert.deepEqual(sent, ['alpha', 'beta'])
    assert.deepEqual(tasks.markSentCalls, [['k-a', 'k-b']])
    assert.deepEqual(report.sent, [
      { tool: 'tasks', key: 'k-a' },
      { tool: 'tasks', key: 'k-b' },
    ])
    assert.deepEqual(report.failed, [])
  })

  test('一則送失敗:其他則照送,失敗的不標記', async () => {
    const tasks = fakeNotifier([
      { key: 'k-a', message: 'alpha' },
      { key: 'k-b', message: 'beta' },
      { key: 'k-c', message: 'gamma' },
    ])
    const { sent, send } = fakeSend(['beta'])
    const report = await runNotifyTick({ now: NOW, tools: TOOLS, notifiers: { tasks }, send })

    assert.deepEqual(sent, ['alpha', 'gamma'])
    assert.deepEqual(tasks.markSentCalls, [['k-a', 'k-c']])
    assert.equal(report.failed.length, 1)
    assert.equal(report.failed[0].tool, 'tasks')
    assert.equal(report.failed[0].stage, 'send')
    assert.equal(report.failed[0].key, 'k-b')
    assert.match(report.failed[0].error, /network down/)
  })

  test('全部送失敗:不呼叫 markSent', async () => {
    const tasks = fakeNotifier([{ key: 'k-a', message: 'alpha' }])
    await runNotifyTick({ now: NOW, tools: TOOLS, notifiers: { tasks }, send: fakeSend(['alpha']).send })
    assert.deepEqual(tasks.markSentCalls, [])
  })

  test('沒有到期的通知:不送、不呼叫 markSent', async () => {
    const tasks = fakeNotifier([])
    const { sent, send } = fakeSend()
    const report = await runNotifyTick({ now: NOW, tools: TOOLS, notifiers: { tasks }, send })
    assert.deepEqual(sent, [])
    assert.deepEqual(tasks.markSentCalls, [])
    assert.deepEqual(report, { sent: [], failed: [] })
  })

  test('工具清單裡沒有通知入口的工具略過', async () => {
    const finance = fakeNotifier([{ key: 'k-f', message: 'from finance' }])
    const { sent, send } = fakeSend()
    await runNotifyTick({ now: NOW, tools: TOOLS, notifiers: { finance }, send })
    assert.deepEqual(sent, ['from finance'])
  })

  test('有通知入口、但不在工具清單裡的不處理', async () => {
    const finance = fakeNotifier([{ key: 'k-f', message: 'from finance' }])
    const { sent, send } = fakeSend()
    await runNotifyTick({ now: NOW, tools: [{ id: 'tasks' }], notifiers: { finance }, send })
    assert.deepEqual(sent, [])
    assert.deepEqual(finance.dueCalls, [])
  })

  test('一個工具的 dueNotifications 丟錯:記進 failed,其他工具照常', async () => {
    const tasks = fakeNotifier(() => {
      throw new Error('db locked')
    })
    const finance = fakeNotifier([{ key: 'k-f', message: 'from finance' }])
    const { sent, send } = fakeSend()
    const report = await runNotifyTick({ now: NOW, tools: TOOLS, notifiers: { tasks, finance }, send })

    assert.deepEqual(sent, ['from finance'])
    assert.deepEqual(finance.markSentCalls, [['k-f']])
    assert.equal(report.failed.length, 1)
    assert.equal(report.failed[0].tool, 'tasks')
    assert.equal(report.failed[0].stage, 'due')
    assert.equal(report.failed[0].key, undefined)
    assert.match(report.failed[0].error, /db locked/)
  })

  test('markSent 丟錯:記進 failed(下個 tick 會重送),其他工具照常', async () => {
    const tasks = fakeNotifier([{ key: 'k-a', message: 'alpha' }])
    tasks.markSent = () => {
      throw new Error('disk full')
    }
    const finance = fakeNotifier([{ key: 'k-f', message: 'from finance' }])
    const report = await runNotifyTick({
      now: NOW,
      tools: TOOLS,
      notifiers: { tasks, finance },
      send: fakeSend().send,
    })

    assert.deepEqual(finance.markSentCalls, [['k-f']])
    const markFailures = report.failed.filter((entry) => entry.stage === 'markSent')
    assert.equal(markFailures.length, 1)
    assert.equal(markFailures[0].tool, 'tasks')
    assert.match(markFailures[0].error, /disk full/)
  })

  test('接受非同步的 dueNotifications 與 markSent', async () => {
    const marked: string[][] = []
    const tasks: ToolNotifier = {
      async dueNotifications() {
        return [{ key: 'k-a', message: 'alpha' }]
      },
      async markSent(keys) {
        marked.push([...keys])
      },
    }
    const { sent, send } = fakeSend()
    await runNotifyTick({ now: NOW, tools: TOOLS, notifiers: { tasks }, send })
    assert.deepEqual(sent, ['alpha'])
    assert.deepEqual(marked, [['k-a']])
  })
})
