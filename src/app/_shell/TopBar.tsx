'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useId, useRef, useState } from 'react'
import {
  findToolByPathname,
  resolveToolHref,
  TOOLS,
  toolLastUrlKey,
  type ToolId,
} from '@/platform/tools'
import styles from './TopBar.module.css'

function LastUrlTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const tool = findToolByPathname(pathname)
    if (!tool) return
    const query = searchParams.toString()
    const url = query ? `${pathname}?${query}` : pathname
    try {
      window.localStorage.setItem(toolLastUrlKey(tool.id), url)
    } catch {
      // 隱私模式或儲存空間不足時略過
    }
  }, [pathname, searchParams])

  return null
}

function readStoredToolUrls(): Partial<Record<ToolId, string>> {
  const result: Partial<Record<ToolId, string>> = {}
  for (const tool of TOOLS) {
    try {
      const raw = window.localStorage.getItem(toolLastUrlKey(tool.id))
      if (raw !== null) {
        result[tool.id] = raw
      }
    } catch {
      // 無法讀取 localStorage 時退回工具首頁
    }
  }
  return result
}

function GridIcon() {
  return (
    <svg className={styles.gridIcon} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="3" r="1.5" />
      <circle cx="8" cy="3" r="1.5" />
      <circle cx="13" cy="3" r="1.5" />
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
      <circle cx="3" cy="13" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />
      <circle cx="13" cy="13" r="1.5" />
    </svg>
  )
}

export default function TopBar() {
  const pathname = usePathname()
  const currentTool = findToolByPathname(pathname)
  const currentLabel = currentTool ? currentTool.name : 'personal-tools'

  const [open, setOpen] = useState(false)
  const [lastUrls, setLastUrls] = useState<Partial<Record<ToolId, string>>>({})

  const panelId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleToggle = () => {
    if (!open) {
      setLastUrls(readStoredToolUrls())
    }
    setOpen((prev) => !prev)
  }

  return (
    <header className={styles.bar}>
      <Suspense fallback={null}>
        <LastUrlTracker />
      </Suspense>
      <div ref={containerRef} className={styles.left}>
        <button
          ref={triggerRef}
          type="button"
          className={styles.trigger}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label="切換工具"
          onClick={handleToggle}
        >
          <GridIcon />
        </button>
        <span className={styles.title}>{currentLabel}</span>

        {open && (
          <nav id={panelId} className={styles.panel} aria-label="工具切換">
            <Link
              href="/"
              className={pathname === '/' ? `${styles.item} ${styles.current}` : styles.item}
              aria-current={pathname === '/' ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              <span className={styles.icon} aria-hidden="true">
                ⌂
              </span>
              <span className={styles.itemBody}>
                <span className={styles.itemName}>首頁</span>
                <span className={styles.itemDesc}>工具入口</span>
              </span>
            </Link>
            {TOOLS.map((tool) => {
              const isCurrent = currentTool?.id === tool.id
              const href = resolveToolHref(tool, lastUrls[tool.id])
              return (
                <Link
                  key={tool.id}
                  href={href}
                  className={isCurrent ? `${styles.item} ${styles.current}` : styles.item}
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span className={styles.icon} aria-hidden="true">
                    {tool.icon}
                  </span>
                  <span className={styles.itemBody}>
                    <span className={styles.itemName}>{tool.name}</span>
                    <span className={styles.itemDesc}>{tool.description}</span>
                  </span>
                </Link>
              )
            })}
          </nav>
        )}
      </div>
      <div className={styles.status} aria-hidden="true" />
    </header>
  )
}
