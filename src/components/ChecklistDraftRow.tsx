import type { Ref } from 'react'
import type { ChecklistDraft } from '@/lib/checklist'
// 和項目列同一套外觀,共用同一份樣式
import styles from './ChecklistItemRow.module.css'

// 只存在於前端的草稿列:按 Enter 或失焦才建立成正式項目。
// 沒有勾選框(留空位對齊)與刪除鈕;空白時按 Backspace 就移除
type Props = {
  draft: ChecklistDraft
  onChange: (value: string) => void
  onEnter: () => void
  onBlur: () => void
  onBackspaceEmpty: () => void
  inputRef: Ref<HTMLInputElement>
}

export default function ChecklistDraftRow({
  draft,
  onChange,
  onEnter,
  onBlur,
  onBackspaceEmpty,
  inputRef,
}: Props) {
  return (
    <li className={styles.row}>
      <div className={styles.line}>
        <span className={styles.spacer} aria-hidden />
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          value={draft.value}
          // 已送出、等重抓帶回正式項目:文字留著顯示,但不能再改
          readOnly={draft.status === 'pending'}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          // 輸入法選字中的 Enter / Backspace 是在操作輸入法,一律不處理
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              onEnter()
            } else if (event.key === 'Backspace' && event.currentTarget.value === '') {
              event.preventDefault()
              onBackspaceEmpty()
            }
          }}
          aria-label="新項目內容"
          placeholder="新項目"
        />
      </div>
    </li>
  )
}
