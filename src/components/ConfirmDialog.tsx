import { useEffect, useId, useRef, useState } from 'react'
import styles from './ConfirmDialog.module.css'

// 通用的確認彈窗,不認得 task;之後其他刪除操作也用這個
type Props = {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void | Promise<unknown>
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  // 確認的請求進行中;props 不收 disabled,由彈窗自己擋連點
  const [pending, setPending] = useState(false)

  // showModal() 才有 Esc 關閉、焦點鎖在彈窗內、背景 inert、關閉後焦點回到觸發按鈕。
  // 先檢查目前狀態:對已開啟的 dialog 呼叫 showModal() 會丟 InvalidStateError,
  // 開發模式下 effect 會執行兩次。
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) {
      return
    }
    if (open) {
      if (!dialog.open) {
        dialog.showModal()
      }
      // 初始焦點明確給「取消」:開啟後直接按 Enter 的結果必須是取消
      cancelRef.current?.focus()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [open])

  async function handleConfirm() {
    setPending(true)
    try {
      await onConfirm()
    } finally {
      setPending(false)
    }
  }

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={styles.dialog}
      // Esc 由原生行為直接關閉,這時 open 還是 true,要通知父層;
      // 父層把 open 改成 false 後 effect 呼叫 close() 也會觸發這裡,那時就不再通知。
      // 不在 cancel 事件 preventDefault:Chrome 連按 Esc 會略過它,狀態會對不上。
      onClose={() => {
        if (open) {
          onCancel()
        }
      }}
      // dialog 自己沒有內距,點到它本身就是點到 backdrop
      onClick={(event) => {
        if (event.target === ref.current) {
          onCancel()
        }
      }}
    >
      <div className={styles.content}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>

        {/* 取消在前、確認在後 */}
        <div className={styles.footer}>
          <button ref={cancelRef} type="button" className={styles.cancel} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={styles.confirm}
            onClick={() => void handleConfirm()}
            disabled={pending}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
