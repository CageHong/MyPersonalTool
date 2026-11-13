import { useRef, useState, type ClipboardEvent, type ReactNode } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { BULK_MAX_LINES, joinAsSingleLine, parseBulkLines } from '@/modules/tasks/lib/bulk'

type Options = {
  // 確認框裡的稱呼:「任務」或「檢查項目」
  noun: string
  // 輸入框目前的值與寫回的方法;按「貼成一行」時把整段插進游標位置
  value: string
  onChange: (value: string) => void
  // 每一行建立一筆;完成(不論成敗)後確認框關閉,錯誤由呼叫端既有的位置顯示
  onCreateMany: (titles: string[]) => Promise<unknown>
}

type Pending = {
  text: string
  lines: string[]
  // 貼上當下的選取範圍:取消時整段文字取代這一段
  start: number
  end: number
}

// 批次貼上(docs/decisions.md §6f)。中欄新增列與 checklist 新增列共用:
// 貼上的純文字切出兩行以上時跳確認框,確認 = 每行建立一筆,取消 = 整段當成一個標題貼進去。
// 單行貼上不攔,照瀏覽器原本的行為;超過上限也不攔,避免誤貼一整份文件時建出上百筆
export function useBulkPaste({ noun, value, onChange, onCreateMany }: Options): {
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void
  dialog: ReactNode
} {
  const [pending, setPending] = useState<Pending | null>(null)
  // 確認框關閉後焦點回到被貼上的那個輸入框
  const targetRef = useRef<HTMLInputElement | null>(null)

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    // 只取純文字:從 Notion、網頁複製會同時帶 HTML
    const text = event.clipboardData.getData('text/plain')
    const lines = parseBulkLines(text)
    if (lines.length < 2 || lines.length > BULK_MAX_LINES) {
      return
    }
    // 攔下來:取消的語意是「整段貼成一個標題」,所以不能先讓瀏覽器改寫輸入框
    event.preventDefault()
    const input = event.currentTarget
    targetRef.current = input
    setPending({
      text,
      lines,
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
    })
  }

  function pasteAsSingleLine() {
    if (pending === null) {
      return
    }
    const joined = joinAsSingleLine(pending.text)
    onChange(value.slice(0, pending.start) + joined + value.slice(pending.end))
    setPending(null)
    // 受控輸入框改值後游標會跳到最後;等這次渲染結束再放回貼上內容的尾端
    const caret = pending.start + joined.length
    requestAnimationFrame(() => targetRef.current?.setSelectionRange(caret, caret))
  }

  const count = pending?.lines.length ?? 0

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={`建立 ${count} 個${noun}?`}
      description={`貼上的內容有 ${count} 行,每一行會成為一個${noun}。選「貼成一行」會把整段當成一個標題。`}
      confirmLabel={`建立 ${count} 個${noun}`}
      cancelLabel="貼成一行"
      tone="action"
      onConfirm={async () => {
        if (pending !== null) {
          await onCreateMany(pending.lines)
        }
        setPending(null)
      }}
      onCancel={pasteAsSingleLine}
      triggerRef={targetRef}
    />
  )

  return { onPaste, dialog }
}
