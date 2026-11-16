'use client'

import { useEffect, useState } from 'react'
import { getJson, loadErrorMessage } from '../lib/api'
import { REPORT_PRESETS, localToday, reportRange } from '../lib/date'
import type { ReportPreset } from '../lib/date'
import { filterToSearchParams } from '../lib/transactions'
import styles from './ReportsPage.module.css'

// 報表類頁面共用的資料載入(useReportData),以及報表頁與固定支出頁共用的期間:選單(過去 12 個月、今年、去年、全部、自訂)+「設為預設」。
// 預設存在瀏覽器的 localStorage,兩頁共用同一個預設

const DEFAULT_KEY = 'finance.reports.defaultPeriod'

export type Period = { preset: ReportPreset } | { preset: 'custom'; from?: string; to?: string }
const FALLBACK: Period = { preset: 'last12' }

function readDefault(): Period {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(DEFAULT_KEY) ?? 'null')
    if (value && typeof value === 'object') {
      const preset = (value as { preset?: unknown }).preset
      if (REPORT_PRESETS.some((p) => p.key === preset)) return { preset: preset as ReportPreset }
      if (preset === 'custom') {
        const { from, to } = value as { from?: unknown; to?: unknown }
        const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
        return { preset: 'custom', from: date(from), to: date(to) }
      }
    }
  } catch {
    // 讀不到或格式不對:用內建的預設
  }
  return FALLBACK
}

export type ReportPeriodState = {
  period: Period
  range: { from?: string; to?: string }
  // 送給報表 API 的查詢字串
  query: string
  choose: (next: Period) => void
  saveDefault: () => void
  saved: boolean
}

export function useReportPeriod(): ReportPeriodState {
  const [today] = useState(() => localToday())
  const [period, setPeriod] = useState<Period>(FALLBACK)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    // 掛載後套用瀏覽器記住的預設期間(伺服器端沒有 localStorage,render 時讀會 hydration 不一致)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeriod(readDefault())
  }, [])

  const range = period.preset === 'custom' ? { from: period.from, to: period.to } : reportRange(period.preset, today)
  return {
    period,
    range,
    query: filterToSearchParams({ order: 'desc', ...range }).toString(),
    choose: (next) => {
      setPeriod(next)
      setSaved(false)
    },
    saveDefault: () => {
      try {
        window.localStorage.setItem(DEFAULT_KEY, JSON.stringify(period))
        setSaved(true)
      } catch {
        // 存不了:不顯示「已設為預設」
      }
    },
    saved,
  }
}

export function ReportPeriodPicker({ state }: { state: ReportPeriodState }) {
  const { period, range, choose } = state
  return (
    <div className={styles.period}>
      <select
        className={styles.field}
        aria-label="期間"
        value={period.preset}
        onChange={(event) => {
          const value = event.target.value
          if (value === 'custom') choose({ preset: 'custom', ...range })
          else choose({ preset: value as ReportPreset })
        }}
      >
        {REPORT_PRESETS.map(({ key, label }) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
        <option value="custom">自訂</option>
      </select>
      {period.preset === 'custom' && (
        <>
          <input
            className={styles.field}
            type="date"
            aria-label="開始日期"
            value={period.from ?? ''}
            max={period.to}
            onChange={(event) => choose({ ...period, from: event.target.value || undefined })}
          />
          <span className={styles.muted}>–</span>
          <input
            className={styles.field}
            type="date"
            aria-label="結束日期"
            value={period.to ?? ''}
            min={period.from}
            onChange={(event) => choose({ ...period, to: event.target.value || undefined })}
          />
        </>
      )}
      <button type="button" className={styles.button} onClick={state.saveDefault}>
        設為預設
      </button>
      {state.saved && <span className={styles.muted}>已設為預設</span>}
    </div>
  )
}

// 取一份報表;網址變了就重新取,舊的資料先留著(stale = true,畫面淡化)
export function useReportData<T>(url: string): { data: T | null; stale: boolean; error: string | null; retry: () => void } {
  const [loaded, setLoaded] = useState<{ url: string; data: T } | null>(null)
  const [error, setError] = useState<{ url: string; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getJson<T>(url, controller.signal)
      .then((data) => {
        setLoaded({ url, data })
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError({ url, message: loadErrorMessage(caught) })
      })
    return () => controller.abort()
  }, [url, attempt])

  return {
    data: loaded?.data ?? null,
    stale: loaded !== null && loaded.url !== url,
    error: error?.url === url ? error.message : null,
    retry: () => setAttempt((n) => n + 1),
  }
}
