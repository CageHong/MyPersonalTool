'use client'

import { useState } from 'react'
import { importErrorMessage, postForm } from '../lib/api'
import type { ImportResult, ImportSummary } from '../lib/import-summary'
import ImportReport from './ImportReport'
import styles from './ImportPage.module.css'

// 對帳單匯入:選檔就試跑(資料庫不變)→ 看報告 → 套用。
// 試跑與套用之間伺服器不存狀態:套用時重送同樣的檔案和試跑的指紋,伺服器重算,帳本變了就拒絕。
// 所以選好的檔案留在這個元件的 state 裡,直到重新選檔

const PLAN_URL = '/api/finance/import/plan'
const APPLY_URL = '/api/finance/import/apply'

function formOf(files: readonly File[]): FormData {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  return form
}

export default function ImportPage() {
  const [files, setFiles] = useState<File[]>([])
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState<'plan' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runPlan(target: readonly File[]) {
    setBusy('plan')
    setError(null)
    try {
      setSummary(await postForm<ImportSummary>(PLAN_URL, formOf(target)))
    } catch (caught) {
      setSummary(null)
      setError(importErrorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  function selectFiles(list: FileList | null) {
    const selected = list ? [...list] : []
    setFiles(selected)
    setSummary(null)
    setResult(null)
    setError(null)
    if (selected.length) void runPlan(selected)
  }

  async function apply() {
    if (!summary) return
    setBusy('apply')
    setError(null)
    const form = formOf(files)
    form.append('fingerprint', summary.fingerprint)
    try {
      setResult(await postForm<ImportResult>(APPLY_URL, form))
    } catch (caught) {
      setError(importErrorMessage(caught))
      setBusy(null)
      return
    }
    // 套用之後重新試跑一次,報告換成帳本現在的狀態(剛寫入的會變成「已經在帳本裡」)
    await runPlan(files)
  }

  const counts = summary?.counts
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>匯入對帳單</h1>
        <p className={styles.hint}>
          目前支援 Wise 的交易紀錄 CSV,可以一次選多份(期間重疊也可以)。選好就會試跑,帳本不會變;確認報告後再套用。
        </p>
      </header>

      <div className={styles.controls}>
        <label className={styles.fileLabel}>
          <span className={styles.fileButton}>選擇檔案</span>
          <input
            className={styles.fileInput}
            type="file"
            accept=".csv,text/csv"
            multiple
            disabled={busy !== null}
            onChange={(event) => {
              selectFiles(event.target.files)
              // 清掉選擇,改過內容的同一個檔案再選一次也會觸發 onChange
              event.target.value = ''
            }}
          />
        </label>
        <span className={styles.fileNames}>
          {files.length ? files.map((file) => file.name).join('、') : '還沒有選擇檔案'}
        </span>
        {files.length > 0 && (
          <button
            type="button"
            className={styles.secondary}
            disabled={busy !== null}
            onClick={() => void runPlan(files)}
          >
            重新試跑
          </button>
        )}
        {summary && counts && (
          <button
            type="button"
            className={styles.primary}
            disabled={busy !== null || !summary.canApply}
            onClick={() => void apply()}
          >
            套用(新增 {counts.new} 筆、補對象 {counts.payeeFixes} 筆)
          </button>
        )}
      </div>

      <p className={styles.status} role="status">
        {busy === 'plan' ? '試跑中…' : busy === 'apply' ? '套用中…' : ''}
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {result && (
        <p className={styles.result}>
          已套用:新增 {result.created} 筆、補對象 {result.payeesFixed} 筆。
          {result.backupPath && <>套用前的備份:<code className={styles.path}>{result.backupPath}</code></>}
        </p>
      )}

      {summary && <ImportReport summary={summary} />}
    </div>
  )
}
