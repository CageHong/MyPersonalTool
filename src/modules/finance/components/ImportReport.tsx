import type { ReactNode } from 'react'
import { formatLocalDate } from '../lib/date'
import type { AccountMoney, FileLine, ImportSummary } from '../lib/import-summary'
import { formatMoney } from '../lib/money'
import styles from './ImportReport.module.css'

// 匯入計畫的報告。只顯示,不做任何操作;要擋套用的項目(無法處理、衝突)預設展開

const CATEGORY_SOURCE_LABELS: Record<string, string> = {
  scheduled: '週期項目',
  rule: '對象規則',
  payee_history: '對象歷史',
  source_category: '來源分類',
}

function Section({
  title,
  count,
  open = false,
  alert = false,
  children,
}: {
  title: string
  count: number
  open?: boolean
  alert?: boolean
  children: ReactNode
}) {
  if (!count) return null
  return (
    <details className={styles.section} open={open}>
      <summary className={alert ? `${styles.sectionTitle} ${styles.alert}` : styles.sectionTitle}>
        {title}({count})
      </summary>
      <div className={styles.sectionBody}>{children}</div>
    </details>
  )
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {head.map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export default function ImportReport({ summary }: { summary: ImportSummary }) {
  const { counts, classification: c, exponents } = summary
  const amounts = (rows: AccountMoney[]) =>
    rows.length ? (
      rows.map((row) => (
        <div key={`${row.account}:${row.currency}`} className={styles.amountLine}>
          <span className={styles.account}>{row.account}</span>
          <span className={styles.amount}>{formatMoney(row.amount, row.currency, exponents)}</span>
        </div>
      ))
    ) : (
      <span className={styles.muted}>(沒有)</span>
    )
  const where = (lines: FileLine[]) =>
    lines.map((line) => `${summary.files[line.file]?.name ?? `檔案 ${line.file + 1}`} 第 ${line.line} 行`).join('、')

  const overview: [string, ReactNode, boolean?][] = [
    ['檔案', summary.files.map((file) => `${file.name}(${file.transactions} 筆)`).join('、')],
    ['交易', `${counts.transactions} 筆(重複的 ID 只算一次),略過 ${counts.skipped} 列`],
    [
      '新的',
      `${counts.new} 筆:週期項目 ${c.scheduled}、對象規則 ${c.rule}、對象歷史 ${c.payeeHistory}、` +
        `來源分類 ${c.sourceCategory}、未分類 ${c.unclassified}、換匯 ${c.exchange}`,
    ],
    [
      '已經在帳本裡',
      `${counts.existing} 筆(要補對象 ${counts.payeeFixes}、金額不同 ${counts.amountDiffs}、入帳對象不用補 ${counts.incomingKept})`,
    ],
    ['帳本有、檔案沒有', `${counts.missingFromFile} 筆`],
    ['無法處理', `${counts.errors} 筆`, counts.errors > 0],
    ['檔案之間內容不同', `${counts.conflicts} 筆`, counts.conflicts > 0],
  ]

  const nothingToWrite = !counts.errors && !counts.conflicts && !counts.new && !counts.payeeFixes

  return (
    <div className={styles.report}>
      <dl className={styles.overview}>
        {overview.map(([label, value, alert]) => (
          <div key={label} className={styles.overviewRow}>
            <dt className={styles.overviewLabel}>{label}</dt>
            <dd className={alert ? styles.alert : undefined}>{value}</dd>
          </div>
        ))}
      </dl>

      {nothingToWrite && <p className={styles.muted}>沒有要寫入的東西:檔案裡的交易都已經在帳本裡。</p>}

      <Section title="無法處理(有任何一筆就不能套用)" count={counts.errors} open alert>
        <Table head={['行', 'ID', '原因']}>
          {summary.errors.map((row, index) => (
            <tr key={`${row.line}:${index}`}>
              <td className={styles.number}>{row.line}</td>
              <td>{row.externalId ?? ''}</td>
              <td>{row.message}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="檔案之間同一個 ID 內容不同(兩筆都不匯入,不能套用)" count={counts.conflicts} open alert>
        <Table head={['ID', '位置']}>
          {summary.conflicts.map((row) => (
            <tr key={row.externalId}>
              <td>{row.externalId}</td>
              <td>{where(row.lines)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="要補對象" count={counts.payeeFixes} open>
        <Table head={['日期', 'ID', '帳本現在', '換成']}>
          {summary.payeeFixes.map((row) => (
            <tr key={row.externalId}>
              <td className={styles.date}>{formatLocalDate(row.occurredAt)}</td>
              <td>{row.externalId}</td>
              <td>{row.from}</td>
              <td>{row.to}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="金額不同(只列出來,不會自動改)" count={counts.amountDiffs}>
        <Table head={['日期', 'ID', '帳本', '檔案']}>
          {summary.amountDiffs.map((row) => (
            <tr key={row.externalId}>
              <td className={styles.date}>{formatLocalDate(row.occurredAt)}</td>
              <td>{row.externalId}</td>
              <td>{amounts(row.existing)}</td>
              <td>{amounts(row.incoming)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="檔案之間同一個 ID 只有備註或來源分類不同(用第一份的)" count={counts.detailDiffs}>
        <Table head={['ID', '位置']}>
          {summary.detailDiffs.map((row) => (
            <tr key={row.externalId}>
              <td>{row.externalId}</td>
              <td>{where(row.lines)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Target fee 不為零(金額欄已經扣掉,請確認)" count={summary.targetFees.length}>
        <Table head={['日期', 'ID', 'Target fee']}>
          {summary.targetFees.map((row, index) => (
            <tr key={`${row.externalId}:${index}`}>
              <td className={styles.date}>{formatLocalDate(row.occurredAt)}</td>
              <td>{row.externalId}</td>
              <td className={styles.number}>
                {row.amount} {row.currency}
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="週期項目同時符合兩個以上(沒有配對)" count={summary.ambiguousScheduled.length}>
        <Table head={['日期', 'ID', '項目 id']}>
          {summary.ambiguousScheduled.map((row) => (
            <tr key={row.externalId}>
              <td className={styles.date}>{formatLocalDate(row.occurredAt)}</td>
              <td>{row.externalId}</td>
              <td>{row.scheduledIds.join('、')}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="略過的列" count={counts.skipped}>
        <Table head={['原因', '列數']}>
          {summary.skipped.map((row) => (
            <tr key={row.reason}>
              <td>{row.reason}</td>
              <td className={styles.number}>{row.count}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="新的" count={counts.new} open>
        <Table head={['日期', '金額', '對象', '分類', '分類來源', '備註']}>
          {summary.newItems.map((row) => (
            <tr key={row.externalId}>
              <td className={styles.date}>{formatLocalDate(row.occurredAt)}</td>
              <td>{amounts(row.source)}</td>
              <td>{row.payee ?? ''}</td>
              <td className={row.category === null ? styles.muted : undefined}>
                {row.kind === 'exchange' ? '換匯' : (row.category ?? '未分類')}
              </td>
              <td className={styles.muted}>
                {row.categorySource ? CATEGORY_SOURCE_LABELS[row.categorySource] : ''}
              </td>
              <td className={styles.note}>{row.note ?? ''}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  )
}
