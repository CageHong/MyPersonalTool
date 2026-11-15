'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { FinanceLookups } from '../lib/transactions'
import styles from './PayeePicker.module.css'

// 對象的選單:可以打字搜尋的下拉選單(ARIA combobox)。篩選列與編輯面板共用。
// 沒打字時最上面是「常用」(交易筆數最多的幾個),下面是依名稱排序的其餘對象;打字時只列名稱部分相符的,依筆數排。
// 有 onCreate 時(編輯面板),打的字跟既有對象都不同名,清單最後多一個「新增」。
// 只回報選了什麼,不存狀態

type Payee = FinanceLookups['payees'][number]

// 常用區塊的個數;只出現過一次的對象不算常用
const COMMON_COUNT = 10

type Props = {
  payees: Payee[] | null
  value: number | undefined
  onChange: (id: number | undefined) => void
  // 選了「新增」;value 這時應該是 undefined,newName 是要新增的名稱
  onCreate?: (name: string) => void
  newName?: string | null
  // 沒選時的提示字
  placeholder?: string
  // 撐滿外層的寬度(編輯面板)
  fullWidth?: boolean
}

type Section = { label: string; items: Payee[] }

function sectionsFor(payees: Payee[], text: string): Section[] {
  const query = text.trim().toLowerCase()
  if (query) {
    const hits = payees
      .filter((p) => p.name.toLowerCase().includes(query))
      .sort((a, b) => b.transactionCount - a.transactionCount || a.name.localeCompare(b.name))
    return [{ label: '符合的對象', items: hits }]
  }
  const common = [...payees]
    .filter((p) => p.transactionCount > 1)
    .sort((a, b) => b.transactionCount - a.transactionCount || a.name.localeCompare(b.name))
    .slice(0, COMMON_COUNT)
  const commonIds = new Set(common.map((p) => p.id))
  // payees 已經依名稱排序(API 的保證)
  const rest = payees.filter((p) => !commonIds.has(p.id))
  return [
    { label: '常用', items: common },
    { label: '全部', items: rest },
  ].filter((section) => section.items.length > 0)
}

export default function PayeePicker({ payees, value, onChange, onCreate, newName, placeholder, fullWidth }: Props) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement | null>(null)

  const selected = payees?.find((p) => p.id === value)
  const sections = open && payees ? sectionsFor(payees, text) : []
  const options = sections.flatMap((section) => section.items)
  const typed = text.trim()
  const createName =
    open && onCreate && payees && typed && !payees.some((p) => p.name.toLowerCase() === typed.toLowerCase())
      ? typed
      : null
  // 「新增」排在所有對象之後,索引是 options.length
  const optionCount = options.length + (createName ? 1 : 0)
  const activeIndex = Math.min(active, Math.max(optionCount - 1, 0))
  const createId = `${listId}-create`
  const optionId = (id: number) => `${listId}-${id}`

  // 鍵盤移動時讓目前的選項保持在看得到的範圍
  useEffect(() => {
    if (!open) return
    const id = options[activeIndex] ? optionId(options[activeIndex].id) : createName ? createId : undefined
    if (id === undefined) return
    listRef.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  function openList() {
    setOpen(true)
    setText('')
    setActive(0)
  }

  function choose(payee: Payee) {
    onChange(payee.id)
    setOpen(false)
  }

  function create(name: string) {
    onCreate?.(name)
    setOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        openList()
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(Math.min(activeIndex + 1, optionCount - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(Math.max(activeIndex - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const payee = options[activeIndex]
      if (payee) choose(payee)
      else if (createName) create(createName)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className={fullWidth ? `${styles.picker} ${styles.fullWidth}` : styles.picker}>
      <input
        className={styles.input}
        role="combobox"
        aria-label="對象"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          !open ? undefined : options[activeIndex] ? optionId(options[activeIndex].id) : createName ? createId : undefined
        }
        placeholder={payees ? (placeholder ?? '所有對象') : '載入中…'}
        disabled={!payees}
        value={open ? text : (selected?.name ?? newName ?? '')}
        onFocus={openList}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setText(event.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
      />
      {(selected || newName) && !open && (
        <button type="button" className={styles.clear} aria-label="清除對象" onClick={() => onChange(undefined)}>
          ×
        </button>
      )}
      {open && (
        <ul ref={listRef} id={listId} role="listbox" aria-label="對象" className={styles.list}>
          {optionCount === 0 && <li className={styles.empty}>沒有符合的對象</li>}
          {sections.map((section) => (
            <li key={section.label} role="presentation">
              <div className={styles.sectionLabel} aria-hidden="true">
                {section.label}
              </div>
              <ul role="group" aria-label={section.label} className={styles.group}>
                {section.items.map((payee) => {
                  const index = options.indexOf(payee)
                  return (
                    <li
                      key={payee.id}
                      id={optionId(payee.id)}
                      role="option"
                      aria-selected={payee.id === value}
                      className={index === activeIndex ? `${styles.option} ${styles.active}` : styles.option}
                      // mousedown 而不是 click:input 的 blur 會先關掉清單
                      onMouseDown={(event) => {
                        event.preventDefault()
                        choose(payee)
                      }}
                      onMouseEnter={() => setActive(index)}
                    >
                      <span>{payee.name}</span>
                      <span className={styles.count}>{payee.transactionCount}</span>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
          {createName && (
            <li
              id={createId}
              role="option"
              aria-selected={false}
              className={activeIndex === options.length ? `${styles.option} ${styles.active}` : styles.option}
              onMouseDown={(event) => {
                event.preventDefault()
                create(createName)
              }}
              onMouseEnter={() => setActive(options.length)}
            >
              <span>新增「{createName}」</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
