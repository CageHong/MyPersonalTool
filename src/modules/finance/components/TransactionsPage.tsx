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
import TransactionEditor from './TransactionEditor'
import TransactionFilters from './TransactionFilters'
import TransactionTable from './TransactionTable'
import styles from './TransactionsPage.module.css'

// 交易清單與單筆編輯。篩選條件放在網址參數:重新整理不會消失、瀏覽器的上一頁可以退回前一組條件。
// 資料由伺服器篩選、一次一頁(keyset 分頁),捲到底自動載入下一頁。
// 「載入中」不另外存:目前的查詢還沒有資料(也沒有錯誤)就是載入中

const LIST_URL = '/api/finance/transactions'
const LOOKUPS_URL = '/api/finance/lookups'
const EDIT_PARAM = 'edit'

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
  // 編輯中的交易(?edit=<id>):跟篩選條件分開,換篩選條件時保留
  const editParam = searchParams.get(EDIT_PARAM)
  const editId = editParam !== null && /^[1-9]\d*$/.test(editParam) ? Number(editParam) : null

  const [lookups, setLookups] = useState<FinanceLookups | null>(null)
  const [lookupsError, setLookupsError] = useState<string | null>(null)
  const [list, setList] = useState<ListState | null>(null)
  const [error, setError] = useState<ForQuery<string> | null>(null)
  const [loadingMore, setLoadingMore] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ForQuery<number> | null>(null)
  const moreRequest = useRef<AbortController | null>(null)
  // 按「重試」時加一,讓對應的 effect 重新取
  const [lookupsAttempt, setLookupsAttempt] = useState(0)
  const [listAttempt, setListAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getJson<FinanceLookups>(LOOKUPS_URL, controller.signal)
      .then(setLookups)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setLookupsError(loadErrorMessage(caught))
      })
    return () => controller.abort()
  }, [lookupsAttempt])

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
  }, [query, listAttempt])

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
        // 換了篩選條件而被取消:新查詢的第一頁失敗時不會清 loadingMore,所以這裡要清
        if (controller.signal.aborted) {
          setLoadingMore((value) => (value === cursor ? null : value))
          return
        }
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

  function navigate(params: URLSearchParams, mode: 'push' | 'replace') {
    const search = params.toString()
    const url = search ? `${pathname}?${search}` : pathname
    if (mode === 'replace') router.replace(url, { scroll: false })
    else router.push(url, { scroll: false })
  }

  // replace:打字搜尋時每個字不各留一筆瀏覽紀錄
  function changeFilter(next: TransactionFilter, mode: 'push' | 'replace' = 'push') {
    const params = filterToSearchParams(next)
    if (editId !== null) params.set(EDIT_PARAM, String(editId))
    navigate(params, mode)
  }

  function setEditing(id: number | null) {
    const params = filterToSearchParams(filter)
    if (id !== null) params.set(EDIT_PARAM, String(id))
    navigate(params, 'push')
  }

  // 存好之後:清單裡的那一列換成新的;選單重新取(可能新增了對象或標籤)。
  // 改過之後不符合目前篩選條件的列先留著,重新整理或換條件時才消失
  function replaceRow(row: TransactionRow) {
    setList((prev) => (prev ? { ...prev, items: prev.items.map((item) => (item.id === row.id ? row : item)) } : prev))
    setLookupsAttempt((n) => n + 1)
  }

  // 刪掉之後:從清單拿掉、關閉右欄
  function removeRow(id: number) {
    setList((prev) => (prev ? { ...prev, items: prev.items.filter((item) => item.id !== id) } : prev))
    setLookupsAttempt((n) => n + 1)
    setEditing(null)
  }

  const message = lookupsError ?? currentError
  // 第一頁失敗就重取第一頁;載入下一頁失敗只要清掉錯誤,底部的哨兵還在畫面裡,會自動再載入
  function retry() {
    if (lookupsError) {
      setLookupsError(null)
      setLookupsAttempt((n) => n + 1)
    }
    if (currentError) {
      setError(null)
      if (!current) setListAttempt((n) => n + 1)
    }
  }
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
        canClear={!isFilterEmpty(filter) || !parsed.ok}
      />

      <div className={styles.body}>
        <div className={styles.listColumn}>
          {/* 換篩選條件時,新資料到之前先留著舊的列(淡化),表格不會整個閃掉 */}
          {list && lookups && (
            <div className={current ? undefined : styles.stale} aria-busy={!current}>
              <TransactionTable
                rows={list.items}
                lookups={lookups}
                expandedId={expandedId}
                editingId={editId}
                onToggle={(id) => setExpanded(expandedId === id ? null : { query, value: id })}
                onEdit={(id) => setEditing(id)}
              />
            </div>
          )}

          <div ref={sentinelRef} className={styles.status} role="status">
            {message ? (
              <>
                <span className={styles.error}>{message}</span>{' '}
                <button type="button" className={styles.retry} onClick={retry}>
                  重試
                </button>
              </>
            ) : (
              status
            )}
          </div>
        </div>

        {editId !== null && lookups && (
          <TransactionEditor
            id={editId}
            lookups={lookups}
            onClose={() => setEditing(null)}
            onSaved={replaceRow}
            onDeleted={removeRow}
          />
        )}
      </div>
    </div>
  )
}
