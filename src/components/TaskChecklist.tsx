import { useCallback, useEffect, useId, useRef, useState } from 'react'
import ChecklistItemRow from './ChecklistItemRow'
import NewChecklistItemForm from './NewChecklistItemForm'
import TaskListSkeleton from './TaskListSkeleton'
import type { ChecklistItem, ChecklistItemPatch } from '@/lib/checklist'
import {
  checklistItemMessage,
  generalMessage,
  NETWORK_ERROR,
  readApiError,
  type ApiError,
} from '@/lib/errors'
import styles from './TaskChecklist.module.css'

type Props = {
  taskId: number
  // 泛用錯誤交給中欄新增列下方顯示;null = 這次寫入成功,清掉舊訊息(同任務側的 mutate)
  onError: (message: string | null) => void
  labelId: string
}

// 404 的意思依動作而定:載入與新增打的是任務的網址,修改與刪除打的是項目的網址
type Target = 'task' | 'item'

function messageFor(failure: ApiError, target: Target): string | null {
  if (failure.kind !== 'general') {
    return null
  }
  return target === 'item' ? checklistItemMessage(failure.code) : generalMessage(failure.code)
}

// 狀態全在這一層:TaskDetail 以 key={task.id} 掛載,換任務時項目、載入狀態、佇列一起清掉
export default function TaskChecklist({ taskId, onError, labelId }: Props) {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const errorIdPrefix = useId()

  // 寫入排隊:每個動作等前一個(含重抓)結束才開始,所以不必停用任何控制項。
  // 例:編輯中直接點刪除鈕,失焦觸發的儲存先排進去,刪除排在它後面,兩個都會執行
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  // 刪除後焦點落到遞補上來那一項;刪的是最後一項就退到前一項,清單空了就落到新增列。
  // 同任務刪除的規則(docs/decisions.md §5)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const addInputRef = useRef<HTMLInputElement>(null)
  const focusAfterDeleteRef = useRef<{ id: number; index: number } | null>(null)

  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = queueRef.current.then(job)
    // 佇列本身不能因為某個動作失敗就斷掉
    queueRef.current = next.catch(() => undefined)
    return next
  }, [])

  // 寫入後整份重抓,不拿回應的物件更新 state,也不做樂觀更新
  const fetchItems = useCallback(async (): Promise<ApiError | null> => {
    const response = await fetch(`/api/tasks/${taskId}/checklist-items`)
    if (!response.ok) {
      return await readApiError(response)
    }
    setItems((await response.json()) as ChecklistItem[])
    setLoadFailed(false)
    return null
  }, [taskId])

  useEffect(() => {
    void enqueue(async () => {
      try {
        const failure = await fetchItems()
        if (failure !== null) {
          setLoadFailed(true)
          onError(messageFor(failure, 'task'))
        }
      } catch {
        setLoadFailed(true)
        onError(generalMessage('NETWORK'))
      } finally {
        setLoading(false)
      }
    })
  }, [enqueue, fetchItems, onError])

  const write = useCallback(
    (request: () => Promise<Response>, target: Target): Promise<ApiError | null> =>
      enqueue(async () => {
        try {
          const response = await request()
          if (!response.ok) {
            const failure = await readApiError(response)
            onError(messageFor(failure, target))
            return failure
          }
          const refetchFailure = await fetchItems()
          onError(refetchFailure === null ? null : messageFor(refetchFailure, 'task'))
          return refetchFailure
        } catch {
          onError(generalMessage('NETWORK'))
          return NETWORK_ERROR
        }
      }),
    [enqueue, fetchItems, onError],
  )

  function patchItem(id: number, patch: ChecklistItemPatch) {
    return write(
      () =>
        fetch(`/api/checklist-items/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }),
      'item',
    )
  }

  function handleCreate(title: string) {
    return write(
      () =>
        fetch(`/api/tasks/${taskId}/checklist-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        }),
      'task',
    )
  }

  async function handleDelete(item: ChecklistItem) {
    // 索引取按下當時的畫面順序;排在前面的動作(存檔、勾選、新增到最後)都不改變它之前的順序
    focusAfterDeleteRef.current = {
      id: item.id,
      index: items.findIndex((current) => current.id === item.id),
    }
    const failure = await write(
      () => fetch(`/api/checklist-items/${item.id}`, { method: 'DELETE' }),
      'item',
    )
    if (failure !== null) {
      focusAfterDeleteRef.current = null
    }
    return failure
  }

  // 列數變少時裁掉陣列尾巴,不留已經卸載的元素;宣告在焦點 effect 之前,先執行
  useEffect(() => {
    inputRefs.current.length = items.length
  }, [items])

  // 被刪的項目從 items 消失 = 重抓已經套用到畫面,這時遞補的輸入框已經掛上
  useEffect(() => {
    const pending = focusAfterDeleteRef.current
    if (pending === null || items.some((item) => item.id === pending.id)) {
      return
    }
    focusAfterDeleteRef.current = null
    // 等待期間使用者已經把焦點放到別處(不是被刪掉的元素留下的 body)就不搶
    if (document.activeElement !== null && document.activeElement !== document.body) {
      return
    }
    const target =
      items.length === 0
        ? addInputRef.current
        : inputRefs.current[Math.min(pending.index, items.length - 1)]
    target?.focus()
  }, [items])

  return (
    <div className={styles.checklist}>
      {/* 和中欄同一份骨架;不先顯示「載入中…」 */}
      {loading && <TaskListSkeleton />}

      {!loading && !loadFailed && items.length === 0 && (
        <p className={styles.empty}>還沒有檢查項目</p>
      )}

      {items.length > 0 && (
        <ul className={styles.list} aria-labelledby={labelId}>
          {items.map((item, index) => (
            <ChecklistItemRow
              key={item.id}
              item={item}
              onToggle={(current) => patchItem(current.id, { done: current.completedAt === null })}
              onRename={(current, title) => patchItem(current.id, { title })}
              onDelete={handleDelete}
              // 行內箭頭函式每次 render 都是新的,React 會重新呼叫,索引跟著當次順序
              inputRef={(element) => {
                inputRefs.current[index] = element
              }}
              errorId={`${errorIdPrefix}-item-${item.id}`}
            />
          ))}
        </ul>
      )}

      {/* 載入失敗時不給新增:不知道這個任務還在不在 */}
      {!loading && !loadFailed && (
        <NewChecklistItemForm
          onCreate={handleCreate}
          inputRef={addInputRef}
          errorId={`${errorIdPrefix}-new`}
        />
      )}
    </div>
  )
}
