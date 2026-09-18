import { useState, type Ref } from 'react'
import Checkbox from './Checkbox'
import CrossIcon from './CrossIcon'
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
  // Enter:在這一項正下方開草稿列並把焦點移過去;失焦觸發這一項原本的儲存
  onInsertBelow: (item: ChecklistItem) => void
  // 輸入框已經是空的時按 Backspace:刪除這一項
  onDeleteByKeyboard: (item: ChecklistItem) => void
  // TaskChecklist 依 id 找輸入框移焦點
  inputRef: Ref<HTMLInputElement>
  errorId: string
}

export default function ChecklistItemRow({
  item,
  onToggle,
  onRename,
  onDelete,
  onInsertBelow,
  onDeleteByKeyboard,
  inputRef,
  errorId,
}: Props) {
  const [fieldError, setFieldError] = useState<string | null>(null)
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
    <li className={styles.row}>
      <div className={styles.line}>
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
              // 不在游標處切開文字;這一項的儲存由焦點移走時的 onBlur 負責
              event.preventDefault()
              onInsertBelow(item)
            } else if (event.key === 'Backspace' && event.currentTarget.value === '') {
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
