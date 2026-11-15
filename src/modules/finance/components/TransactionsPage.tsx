'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getJson, loadErrorMessage } from '../lib/api'
import {
  EMPTY_FILTER,
  filterToSearchParams,
  isFilterEmpty,
  parseTransactionFilter,
} from '../lib/transactions'
import type { FinanceLookups, TransactionFilter, TransactionPage, TransactionRow } from '../lib/transactions'
import TransactionFilters from './TransactionFilters'
import TransactionTable from './TransactionTable'
import styles from './TransactionsPage.module.css'

// 交易清單(唯讀)。篩選條件放在網址參數:重新整理不會消失、瀏覽器的上一頁可以退回前一組條件。
// 資料由伺服器篩選、一次一頁(keyset 分頁),捲到底自動載入下一頁。
// 「載入中」不另外存:目前的查詢還沒有資料(也沒有錯誤)就是載入中

const LIST_URL = '/api/finance/transactions'
const LOOKUPS_URL = '/api/finance/lookups'

type ListState = {
  // 這批資料對應的查詢字串;跟網址不同代表資料過時了
  query: string
  items: TransactionRow[]
  nextCursor: string | null
}

// 錯誤、展開的列都記住屬於哪個查詢,換查詢就自然失效
type ForQuery<T> = { query: string; value: T }

function pageUrl(query: string, cursor?: string): string {
  const params = new URLSearchParams(query)
  if (cursor) params.set('cursor', cursor)
  return `${LIST_URL}?${params}`
}

export default function TransactionsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // 網址 → 篩選條件。網址不合法時當作沒有篩選,並提示
  const parsed = useMemo(() => parseTransactionFilter(new URLSearchParams(searchParams.toString())), [searchParams])
  const filter = parsed.ok ? parsed.filter : EMPTY_FILTER
  const query = filterToSearchParams(filter).toString()

  const [lookups, setLookups] = useState<FinanceLookups | null>(null)
  const [lookupsError, setLookupsError] = useState<string | null>(null)
  const [list, setList] = useState<ListState | null>(null)
  const [error, setError] = useState<ForQuery<string> | null>(null)
  const [loadingMore, setLoadingMore] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ForQuery<number> | null>(null)
  const moreRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getJson<FinanceLookups>(LOOKUPS_URL, controller.signal)
      .then(setLookups)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setLookupsError(loadErrorMessage(caught))
      })
    return () => controller.abort()
  }, [])

  // 篩選條件變了就從第一頁重新取;進行中的上一個查詢(含載入下一頁)取消
  useEffect(() => {
    moreRequest.current?.abort()
    const controller = new AbortController()
    getJson<TransactionPage>(pageUrl(query), controller.signal)
      .then((page) => {
        setList({ query, items: page.items, nextCursor: page.nextCursor })
        setLoadingMore(null)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError({ query, value: loadErrorMessage(caught) })
      })
    return () => controller.abort()
  }, [query])

  const current = list?.query === query ? list : null
  const currentError = error?.query === query ? error.value : null
  const expandedId = expanded?.query === query ? expanded.value : null

  const loadMore = useCallback(() => {
    const cursor = current?.nextCursor
    if (!cursor || loadingMore === cursor || currentError) return
    const controller = new AbortController()
    moreRequest.current = controller
    setLoadingMore(cursor)
    getJson<TransactionPage>(pageUrl(query, cursor), controller.signal)
      .then((page) => {
        setList((prev) =>
          prev?.query === query ? { query, items: [...prev.items, ...page.items], nextCursor: page.nextCursor } : prev,
        )
        setLoadingMore(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError({ query, value: loadErrorMessage(caught) })
        setLoadingMore(null)
      })
  }, [current, loadingMore, currentError, query])

  // 捲到清單底部的哨兵進入畫面時,自動載入下一頁
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadMore])

  // replace:打字搜尋時每個字不各留一筆瀏覽紀錄
  function changeFilter(next: TransactionFilter, mode: 'push' | 'replace' = 'push') {
    const search = filterToSearchParams(next).toString()
    const url = search ? `${pathname}?${search}` : pathname
    if (mode === 'replace') router.replace(url, { scroll: false })
    else router.push(url, { scroll: false })
  }

  const message = lookupsError ?? currentError
  let status: string
  if (!current || !lookups) status = '載入中…'
  else if (loadingMore) status = `已載入 ${current.items.length} 筆,載入更多中…`
  else if (current.items.length === 0) status = isFilterEmpty(filter) ? '帳本裡還沒有交易。' : '沒有符合條件的交易。'
  else if (current.nextCursor) status = `已載入 ${current.items.length} 筆`
  else status = `共 ${current.items.length} 筆`

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>交易</h1>
      </header>

      {!parsed.ok && <p className={styles.error}>網址裡的篩選條件不合法,目前顯示全部交易。</p>}

      <TransactionFilters
        filter={filter}
        lookups={lookups}
        onChange={changeFilter}
        onClear={() => changeFilter({ ...EMPTY_FILTER, order: filter.order })}
        canClear={!isFilterEmpty(filter)}
      />

      {/* 換篩選條件時,新資料到之前先留著舊的列(淡化),表格不會整個閃掉 */}
      {list && lookups && (
        <div className={current ? undefined : styles.stale} aria-busy={!current}>
          <TransactionTable
            rows={list.items}
            lookups={lookups}
            expandedId={expandedId}
            onToggle={(id) => setExpanded(expandedId === id ? null : { query, value: id })}
          />
        </div>
      )}

      <div ref={sentinelRef} className={styles.status} role="status">
        {message ? <span className={styles.error}>{message}</span> : status}
      </div>
    </div>
  )
}
