import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import styles from './ConfirmDialog.module.css'

// 通用的確認彈窗,不認得 task;之後其他刪除操作也用這個
type Props = {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void | Promise<unknown>
  onCancel: () => void
  // 關閉後焦點回到這裡。確認成功後觸發鈕通常跟著卸載(例:刪除),那時不會有 close 事件,
  // 焦點交給呼叫端既有的處理
  triggerRef: RefObject<HTMLElement | null>
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  triggerRef,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  // 確認的請求進行中;props 不收 disabled,由彈窗自己擋連點
  const [pending, setPending] = useState(false)

  // showModal() 才有 Esc 關閉、焦點鎖在彈窗內、背景 inert。
  // 關閉後焦點在 close 事件裡明確移回觸發鈕,不靠瀏覽器自動歸還(各瀏覽器不一致)。
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
      // 所有關閉路徑都經 close() 走到這裡:取消鈕、點背景、Esc(原生行為直接關閉),
      // 這三種 open 都還是 true,要通知父層;確認後父層把 open 改成 false、effect 呼叫 close()
      // 也會觸發這裡(例:刪除失敗,觸發鈕還在),那時不再通知。
      // 不在 cancel 事件 preventDefault:Chrome 連按 Esc 會略過它,狀態會對不上。
      onClose={() => {
        if (open) {
          onCancel()
        }
        // 觸發鈕已經卸載就不動焦點
        if (triggerRef.current?.isConnected) {
          triggerRef.current.focus()
        }
      }}
      // dialog 自己沒有內距,點到它本身就是點到 backdrop
      onClick={(event) => {
        if (event.target === ref.current) {
          ref.current.close()
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
          <button
            ref={cancelRef}
            type="button"
            className={styles.cancel}
            onClick={() => ref.current?.close()}
          >
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
