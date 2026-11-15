'use client'

import { useEffect, useState } from 'react'
import { adminErrorMessage, getJson, loadErrorMessage, sendNoContent } from '../lib/api'
import type { DeletedImportRow } from '../lib/balance-accounts'
import { formatLocalDate } from '../lib/date'
import { formatMoney } from '../lib/money'
import type { FinanceLookups } from '../lib/transactions'
import styles from './AdminPage.module.css'

// 匯入頁下方:在交易清單刪掉過的匯入交易。匯入同一份檔案時不會加回來;按「取消刪除」後,下次匯入會重新加進來

const URL = '/api/finance/import/deleted'

export default function DeletedImports() {
  const [items, setItems] = useState<DeletedImportRow[] | null>(null)
  const [exponents, setExponents] = useState<Record<string, number>>({})
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      getJson<{ items: DeletedImportRow[] }>(URL, controller.signal),
      getJson<FinanceLookups>('/api/finance/lookups', controller.signal),
    ])
      .then(([result, lookups]) => {
        setItems(result.items)
        setExponents(lookups.exponents)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(loadErrorMessage(caught))
      })
    return () => controller.abort()
  }, [attempt])

  if (!items?.length && !error) return null
  return (
    <section className={styles.section} aria-label="刪掉過的匯入交易">
      <h2 className={styles.sectionTitle}>刪掉過的匯入交易</h2>
      <p className={styles.muted}>匯入同一份檔案時這些不會加回來。取消刪除後,下次匯入會重新加進來。</p>
      {error && <p className={styles.error}>{error}</p>}
      {items && items.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>交易日期</th>
              <th>對象</th>
              <th className={styles.number}>金額</th>
              <th>刪除時間</th>
              <th>
                <span className={styles.muted}>操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.externalId}>
                <td>{item.occurredAt ? formatLocalDate(item.occurredAt) : item.externalId}</td>
                <td>{item.payee ?? '—'}</td>
                <td className={styles.number}>
                  {item.amounts.map((a) => formatMoney(a.amount, a.currency, exponents)).join('、')}
                </td>
                <td>{formatLocalDate(item.deletedAt)}</td>
                <td>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => {
                      setError(null)
                      sendNoContent('DELETE', URL, { externalId: item.externalId })
                        .then(() => setAttempt((n) => n + 1))
                        .catch((caught: unknown) => setError(adminErrorMessage(caught)))
                    }}
                  >
                    取消刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
