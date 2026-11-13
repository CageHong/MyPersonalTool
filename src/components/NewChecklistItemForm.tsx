import { useRef, useState, type FormEvent, type Ref } from 'react'
import { fieldMessage, type ApiError } from '@/lib/errors'
import { useBulkPaste } from './useBulkPaste'
import styles from './NewChecklistItemForm.module.css'

type Props = {
  onCreate: (title: string) => Promise<ApiError | null>
  // 批次貼上:每一行一項,整批放在最後
  onCreateMany: (titles: string[]) => Promise<ApiError | null>
  // 刪除最後一個項目後,焦點落到這裡
  inputRef: Ref<HTMLInputElement>
  errorId: string
}

export default function NewChecklistItemForm({ onCreate, onCreateMany, inputRef, errorId }: Props) {
  const [title, setTitle] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  // 自己送出的請求還沒回來時擋掉第二次 Enter,免得同一行字建立兩次。
  // 不停用也不設 readOnly:使用者可以接著打下一項
  const pendingRef = useRef(false)

  // 用 <form> 的隱式送出處理 Enter:輸入法選字中的 Enter 不會送出
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRef.current || title.trim() === '') {
      return
    }

    const submitted = title
    pendingRef.current = true
    const failure = await onCreate(submitted)
    pendingRef.current = false

    if (failure === null) {
      // 等待期間使用者已經開始打下一項的話,不要清掉他打的字
      setTitle((current) => (current === submitted ? '' : current))
    } else if (failure.kind === 'fields' && failure.fields.title !== undefined) {
      setFieldError(fieldMessage('title', failure.fields.title))
    }
  }

  const bulk = useBulkPaste({
    noun: '檢查項目',
    value: title,
    onChange: (next) => {
      setTitle(next)
      setFieldError(null)
    },
    onCreateMany,
  })

  return (
    <>
      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className={fieldError === null ? styles.input : `${styles.input} ${styles.invalid}`}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            setFieldError(null)
          }}
          onPaste={bulk.onPaste}
          aria-label="新增檢查項目"
          placeholder="新增項目"
          aria-invalid={fieldError !== null || undefined}
          aria-describedby={fieldError === null ? undefined : errorId}
        />
        {fieldError !== null && (
          <p id={errorId} className={styles.error} role="alert">
            {fieldError}
          </p>
        )}
      </form>
      {bulk.dialog}
    </>
  )
}
