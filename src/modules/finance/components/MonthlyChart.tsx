'use client'

import { useState } from 'react'
import { formatAmount, formatMoney } from '../lib/money'
import type { MonthlyReport } from '../lib/reports'
import styles from './MonthlyChart.module.css'

// 每月支出的長條圖(自己畫的 SVG):固定在下、變動疊在上。
// 比中位數高很多的月份截斷,頂端畫斷裂記號並標出金額;滑過或聚焦顯示那個月的數字,點一下跳到那個月的交易

// 版面的值(px):每個月的寬度、長條寬度、繪圖區高度、上方標籤與下方月份的空間
const SLOT = 36
const BAR = 24
const PLOT = 180
const TOP = 18
const BOTTOM = 32
const LEFT = 8
// 超過中位數這麼多倍才截斷
const CAP_RATIO = 2.5

type Props = {
  report: MonthlyReport
  onSelect: (month: string) => void
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export default function MonthlyChart({ report, onSelect }: Props) {
  const [active, setActive] = useState<string | null>(null)
  const { months, currency, exponents } = report
  if (!months.length) return null

  const exponent = exponents[currency] ?? 2
  // 退款多於支出的月份,長條從 0 開始
  const bars = months.map((m) => {
    const fixed = Math.max(m.expense.fixed, 0)
    const variable = Math.max(m.expense.variable, 0)
    return { month: m.month, fixed, variable, total: fixed + variable }
  })
  const totals = bars.map((b) => b.total).filter((t) => t > 0)
  const max = totals.length ? Math.max(...totals) : 0
  const mid = totals.length ? median(totals) : 0
  const cap = mid > 0 && max > mid * CAP_RATIO ? mid * CAP_RATIO : max
  const scale = (value: number) => (cap > 0 ? (Math.min(value, cap) / cap) * PLOT : 0)
  // 整數單位(不帶小數)的金額,給圖上的小標籤
  const whole = (value: number) => formatAmount(Math.round(value / 10 ** exponent) * 10 ** exponent, exponent).replace(/\.\d+$/, '')

  const width = LEFT * 2 + bars.length * SLOT
  const height = TOP + PLOT + BOTTOM
  const base = TOP + PLOT
  // 月份很多時只標一部分
  const every = bars.length > 24 ? 3 : 1
  const shown = months.find((m) => m.month === active)

  return (
    <div className={styles.chart}>
      <p className={styles.info} aria-live="polite">
        {shown
          ? `${shown.month}:支出 ${formatMoney(shown.expense.total, currency, exponents)}(固定 ${formatMoney(shown.expense.fixed, currency, exponents)}、變動 ${formatMoney(shown.expense.variable, currency, exponents)}),收入 ${formatMoney(shown.income, currency, exponents)}`
          : '滑過長條看數字,點一下看那個月的交易'}
      </p>
      <div className={styles.scroll}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${bars.length} 個月的固定與變動支出`}>
          {cap > 0 && (
            <g>
              <line x1={LEFT} x2={width - LEFT} y1={TOP} y2={TOP} className={styles.grid} />
              <text x={width - LEFT} y={TOP - 4} className={styles.axis} textAnchor="end">
                {whole(cap)}
              </text>
            </g>
          )}
          <line x1={LEFT} x2={width - LEFT} y1={base} y2={base} className={styles.grid} />
          {bars.map((bar, index) => {
            const x = LEFT + index * SLOT + (SLOT - BAR) / 2
            const truncated = bar.total > cap
            const fixedH = truncated ? scale(cap * (bar.fixed / bar.total)) : scale(bar.fixed)
            const totalH = scale(bar.total)
            const [year, month] = bar.month.split('-')
            const label = index % every === 0 || month === '01'
            return (
              <g
                key={bar.month}
                className={active === bar.month ? `${styles.slot} ${styles.active}` : styles.slot}
                role="button"
                tabIndex={0}
                aria-label={`${bar.month} 支出 ${formatMoney(bar.total, currency, exponents)}`}
                onMouseEnter={() => setActive(bar.month)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(bar.month)}
                onBlur={() => setActive(null)}
                onClick={() => onSelect(bar.month)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(bar.month)
                  }
                }}
              >
                {/* 整個月份的欄都可以滑過、點擊 */}
                <rect x={LEFT + index * SLOT} y={0} width={SLOT} height={height} className={styles.hit} />
                <rect x={x} y={base - fixedH} width={BAR} height={fixedH} className={styles.fixed} />
                <rect x={x} y={base - totalH} width={BAR} height={totalH - fixedH} className={styles.variable} />
                {truncated && (
                  <>
                    <line x1={x} x2={x + BAR} y1={TOP + 6} y2={TOP + 2} className={styles.break} />
                    <line x1={x} x2={x + BAR} y1={TOP + 10} y2={TOP + 6} className={styles.break} />
                    <text x={x + BAR / 2} y={TOP - 4} className={styles.axis} textAnchor="middle">
                      {whole(bar.total)}
                    </text>
                  </>
                )}
                {label && (
                  <text x={x + BAR / 2} y={base + 14} className={styles.axis} textAnchor="middle">
                    {Number(month)}
                  </text>
                )}
                {(month === '01' || index === 0) && (
                  <text x={x + BAR / 2} y={base + 27} className={styles.axis} textAnchor="middle">
                    {year}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <p className={styles.legend}>
        <span className={styles.swatchFixed} aria-hidden="true" /> 固定
        <span className={styles.swatchVariable} aria-hidden="true" /> 變動
      </p>
    </div>
  )
}
