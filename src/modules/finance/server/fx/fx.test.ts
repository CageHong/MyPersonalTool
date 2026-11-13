import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { applyMigrations, openDb } from '../../db/index'
import { fetchFrankfurterRates, parseFrankfurterRates } from './frankfurter'
import { FxRateMissingError, convert, getRate, latestRateDate, storeRates } from './index'

function freshDb() {
  const db = openDb(':memory:')
  applyMigrations(db)
  db.run(sql`INSERT INTO finance_currencies VALUES ('EUR', 2, 'Euro'), ('USD', 2, 'US Dollar'),
             ('TWD', 0, 'New Taiwan Dollar'), ('GBP', 2, 'Pound')`)
  storeRates(
    db,
    [
      { date: '2026-01-05', currency: 'USD', rateToEur: 0.8 },
      { date: '2026-01-07', currency: 'USD', rateToEur: 0.9 },
      { date: '2026-01-05', currency: 'TWD', rateToEur: 0.025 },
    ],
    { source: 'test', fetchedAt: '2026-01-08T00:00:00Z' },
  )
  return db
}

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`)

test('相同幣別的匯率是 1,不需要資料', () => {
  assert.equal(getRate(freshDb(), 'GBP', 'GBP', '2026-01-05'), 1)
})

test('對歐元:直接用表裡的值,反方向取倒數', () => {
  const db = freshDb()
  close(getRate(db, 'USD', 'EUR', '2026-01-05'), 0.8)
  close(getRate(db, 'EUR', 'USD', '2026-01-05'), 1.25)
})

test('兩個非歐元幣別經過歐元換算', () => {
  close(getRate(freshDb(), 'USD', 'TWD', '2026-01-05'), 0.8 / 0.025)
})

test('當天沒有資料時沿用之前最近的一天', () => {
  const db = freshDb()
  close(getRate(db, 'USD', 'EUR', '2026-01-06'), 0.8)
  close(getRate(db, 'USD', 'EUR', '2026-02-01'), 0.9)
})

test('比最早的資料還早時用最早的一筆', () => {
  close(getRate(freshDb(), 'USD', 'EUR', '2025-12-01'), 0.8)
})

test('完全沒有資料的幣別會丟出 FxRateMissingError', () => {
  assert.throws(() => getRate(freshDb(), 'GBP', 'EUR', '2026-01-05'), FxRateMissingError)
})

test('當天有直接報價時優先使用,兩個方向都可以查;隔天就不用', () => {
  const db = freshDb()
  db.run(sql`INSERT INTO finance_fx_direct_quotes VALUES ('2026-01-05', 'TWD', 'USD', 0.03, 'test', '2026-01-08T00:00:00Z')`)
  close(getRate(db, 'TWD', 'USD', '2026-01-05'), 0.03)
  close(getRate(db, 'USD', 'TWD', '2026-01-05'), 1 / 0.03)
  close(getRate(db, 'USD', 'TWD', '2026-01-06'), 0.8 / 0.025)
})

test('換算最小貨幣單位:小數位數不同的幣別', () => {
  const db = freshDb()
  const usd = { currency: 'USD', exponent: 2 }
  const twd = { currency: 'TWD', exponent: 0 }
  // 100.00 USD = 80 EUR = 3200 TWD
  close(convert(db, 10000, usd, twd, '2026-01-05'), 3200)
  close(convert(db, 3200, twd, usd, '2026-01-05'), 10000)
})

test('寫入:同一天同一個幣別會覆蓋;replaceAll 會清掉舊資料', () => {
  const db = freshDb()
  storeRates(db, [{ date: '2026-01-05', currency: 'USD', rateToEur: 0.85 }], {
    source: 'new',
    fetchedAt: '2026-01-09T00:00:00Z',
  })
  close(getRate(db, 'USD', 'EUR', '2026-01-05'), 0.85)
  assert.equal(latestRateDate(db, 'new'), '2026-01-05')
  assert.equal(latestRateDate(db, 'test'), '2026-01-07')
  storeRates(db, [{ date: '2026-01-10', currency: 'USD', rateToEur: 0.7 }], {
    source: 'new',
    fetchedAt: '2026-01-11T00:00:00Z',
    replaceAll: true,
  })
  assert.equal(latestRateDate(db, 'test'), null)
  assert.throws(() => getRate(db, 'TWD', 'EUR', '2026-01-05'), FxRateMissingError)
})

test('Frankfurter:回應轉成對歐元的匯率', () => {
  const rates = parseFrankfurterRates([
    { date: '2026-11-02', base: 'EUR', quote: 'TWD', rate: 40 },
    { date: '2026-11-02', base: 'EUR', quote: 'USD', rate: 1.25 },
  ])
  assert.deepEqual(rates.map((r) => [r.date, r.currency]), [
    ['2026-11-02', 'TWD'],
    ['2026-11-02', 'USD'],
  ])
  close(rates[0].rateToEur, 0.025)
  close(rates[1].rateToEur, 0.8)
})

test('Frankfurter:格式不對的回應會丟出錯誤', () => {
  assert.throws(() => parseFrankfurterRates({ status: 422, message: 'invalid date' }))
  assert.throws(() => parseFrankfurterRates([{ date: '2026-11-02', base: 'USD', quote: 'TWD', rate: 30 }]))
  assert.throws(() => parseFrankfurterRates([{ date: '2026-11-02', base: 'EUR', quote: 'TWD', rate: 0 }]))
})

test('Frankfurter:請求的網址與 HTTP 錯誤', async () => {
  let requested = ''
  const rates = await fetchFrankfurterRates({ currencies: ['TWD', 'USD'], from: '2026-11-02' }, async (url) => {
    requested = url
    return { ok: true, status: 200, json: async () => [{ date: '2026-11-02', base: 'EUR', quote: 'TWD', rate: 40 }] }
  })
  assert.equal(requested, 'https://api.frankfurter.dev/v2/rates?base=EUR&quotes=TWD%2CUSD&from=2026-11-02')
  assert.equal(rates.length, 1)
  await assert.rejects(
    fetchFrankfurterRates({ currencies: ['TWD'], from: '2026-11-02' }, async () => ({
      ok: false,
      status: 422,
      json: async () => ({}),
    })),
    /HTTP 422/,
  )
})
