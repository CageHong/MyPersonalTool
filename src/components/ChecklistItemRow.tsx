import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState, type Ref } from 'react'
import Checkbox from './Checkbox'
import CrossIcon from './CrossIcon'
import GripIcon from './GripIcon'
import { fieldMessage, type ApiError } from '@/lib/errors'
import type { ChecklistItem } from '@/lib/checklist'
import { useDraft } from '@/lib/useDraft'
import styles from './ChecklistItemRow.module.css'

// 寫入由 TaskChecklist 排隊執行,這裡的控制項都不停用:
// 有焦點的元素被停用會把焦點丟到 body,編輯中直接點刪除鈕的 click 也會被吞掉
type Props = {
  item: ChecklistItem
  onToggle: (item: ChecklistItem) => Promise<ApiError | null>
  onRename: (item: ChecklistItem, title: string) => Promise<ApiError | null>
  onDelete: (item: ChecklistItem) => Promise<ApiError | null>
  // 輸入框已經是空的時按 Backspace:刪除這一項
  onDeleteByKeyboard: (item: ChecklistItem) => void
  // 刪除後要把焦點放到遞補上來那一項的輸入框
  inputRef: Ref<HTMLInputElement>
  // 放下後要把焦點留在這一項的把手上
  handleRef: (element: HTMLButtonElement | null) => void
  errorId: string
}

export default function ChecklistItemRow({
  item,
  onToggle,
  onRename,
  onDelete,
  onDeleteByKeyboard,
  inputRef,
  handleRef,
  errorId,
}: Props) {
  const [fieldError, setFieldError] = useState<string | null>(null)
  // 只有把手能啟動拖曳:listeners、attributes 與 activator ref 都只掛在把手上,
  // li 只負責跟著移動
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, attributes: { roleDescription: '可拖曳排序的項目' } })
  const done = item.completedAt !== null

  // 內容沒變(含只差前後空白)或改成空白都不送請求;回傳 null 讓 useDraft 放掉草稿,
  // 空白的情況就會恢復成伺服器的文字
  async function save(value: string): Promise<ApiError | null> {
    const title = value.trim()
    if (title === '' || title === item.title) {
      return null
    }
    const failure = await onRename(item, title)
    if (failure?.kind === 'fields' && failure.fields.title !== undefined) {
      setFieldError(fieldMessage('title', failure.fields.title))
    }
    return failure
  }

  const draft = useDraft(item.title, save)

  const inputClasses = [styles.input]
  if (done) {
    inputClasses.push(styles.done)
  }
  if (fieldError !== null) {
    inputClasses.push(styles.invalid)
  }

  return (
    <li
      ref={setNodeRef}
      className={isDragging ? `${styles.row} ${styles.dragging}` : styles.row}
      // 位移由 dnd-kit 逐格算出,只能寫在 inline style;用 Translate 不用 Transform,列高不同時不會被縮放
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div className={styles.line}>
        <button
          type="button"
          ref={(element) => {
            setActivatorNodeRef(element)
            handleRef(element)
          }}
          className={styles.handle}
          {...attributes}
          {...listeners}
          aria-label={`拖曳排序:${item.title}`}
        >
          <GripIcon />
        </button>
        <Checkbox
          checked={done}
          onChange={() => void onToggle(item)}
          aria-label={`完成「${item.title}」`}
        />
        <input
          ref={inputRef}
          type="text"
          className={inputClasses.join(' ')}
          value={draft.value}
          onFocus={draft.onFocus}
          onChange={(event) => {
            draft.onChange(event.target.value)
            setFieldError(null)
          }}
          onBlur={draft.onBlur}
          // 輸入法選字中的 Enter / Backspace 是在操作輸入法,一律不處理
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return
            }
            if (event.key === 'Enter') {
              // Enter 等同失焦:存檔走同一條路
              event.currentTarget.blur()
            } else if (
              event.key === 'Backspace' &&
              // 按住不放的重複事件不刪:按住只會把文字清空、停在空白,放開再按一次才刪
              !event.repeat &&
              event.currentTarget.value === ''
            ) {
              event.preventDefault()
              onDeleteByKeyboard(item)
            }
          }}
          aria-label="項目內容"
          aria-invalid={fieldError !== null || undefined}
          aria-describedby={fieldError === null ? undefined : errorId}
        />
        {/* 不跳確認:項目很輕,刪錯重打一行就好 */}
        <button
          type="button"
          className={styles.delete}
          onClick={() => void onDelete(item)}
          aria-label={`刪除項目:${item.title}`}
        >
          <CrossIcon />
        </button>
      </div>
      {fieldError !== null && (
        <p id={errorId} className={styles.error} role="alert">
          {fieldError}
        </p>
      )}
    </li>
  )
}
