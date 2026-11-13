import {
  closestCenter,
  DndContext,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import ChecklistItemRow from './ChecklistItemRow'
import {
  checklistAnnouncements,
  GuardedKeyboardSensor,
  GuardedPointerSensor,
  screenReaderInstructions,
} from './checklistSortable'
import NewChecklistItemForm from './NewChecklistItemForm'
import TaskListSkeleton from './TaskListSkeleton'
import type { ChecklistItem, ChecklistItemPatch } from '@/modules/tasks/lib/checklist'
import {
  checklistItemMessage,
  generalMessage,
  NETWORK_ERROR,
  readApiError,
  type ApiError,
} from '@/modules/tasks/lib/errors'
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
  // 佇列裡還沒完成的動作數(含執行中的那個)。拖曳感應器在按下的當下讀它:
  // 大於 0 就不啟動,不需要 state,也不會觸發重新渲染
  const pendingWritesRef = useRef(0)

  // 刪除後的焦點,清單空了都落到新增列:
  // - 刪除鈕(prefer: 'next'):遞補上來那一項;刪的是最後一項就退到前一項。
  //   同任務刪除的規則(docs/tasks/decisions.md §5)
  // - 空白項目按 Backspace(prefer: 'previous'):上一項,游標在末尾,接著打;刪的是第一項就到下一項
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const addInputRef = useRef<HTMLInputElement>(null)
  const focusAfterDeleteRef = useRef<{
    id: number
    index: number
    prefer: 'next' | 'previous'
    caretEnd: boolean
  } | null>(null)
  // 已排入 DELETE、還沒重抓完的項目。等待期間焦點留在那個空白輸入框,
  // 再按 Backspace(或連點刪除鈕)不能對同一項排第二個 DELETE,否則第二個會回 404
  const deletingIdsRef = useRef(new Set<number>())

  // 放下(或取消)後焦點留在被拖曳項目的把手上
  const handleRefs = useRef(new Map<number, HTMLButtonElement>())
  const focusHandleIdRef = useRef<number | null>(null)

  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    pendingWritesRef.current += 1
    const next = queueRef.current.then(job).finally(() => {
      pendingWritesRef.current -= 1
    })
    // 佇列本身不能因為某個動作失敗就斷掉
    queueRef.current = next.catch(() => undefined)
    return next
  }, [])

  // 寫入後整份重抓,不拿回應的物件更新 state,也不做樂觀更新
  const fetchItems = useCallback(async (): Promise<ApiError | null> => {
    const response = await fetch(`/api/tasks/tasks/${taskId}/checklist-items`)
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
        fetch(`/api/tasks/checklist-items/${id}`, {
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
        fetch(`/api/tasks/tasks/${taskId}/checklist-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        }),
      'task',
    )
  }

  // 批次貼上:一個請求、一個 transaction,整批成功才出現在清單裡
  function handleCreateMany(titles: string[]) {
    return write(
      () =>
        fetch(`/api/tasks/tasks/${taskId}/checklist-items/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ titles }),
        }),
      'task',
    )
  }

  async function deleteItem(
    item: ChecklistItem,
    prefer: 'next' | 'previous',
    caretEnd: boolean,
  ): Promise<ApiError | null> {
    if (deletingIdsRef.current.has(item.id)) {
      return null
    }
    deletingIdsRef.current.add(item.id)
    // 索引取按下當時的畫面順序;排在前面的動作(存檔、勾選、新增到最後)都不改變它之前的順序
    focusAfterDeleteRef.current = {
      id: item.id,
      index: items.findIndex((current) => current.id === item.id),
      prefer,
      caretEnd,
    }
    // write 在重抓完成後才 resolve,這時項目已經從畫面上拿掉
    const failure = await write(
      () => fetch(`/api/tasks/checklist-items/${item.id}`, { method: 'DELETE' }),
      'item',
    )
    deletingIdsRef.current.delete(item.id)
    if (failure !== null) {
      focusAfterDeleteRef.current = null
    }
    return failure
  }

  function handleDelete(item: ChecklistItem) {
    return deleteItem(item, 'next', false)
  }

  // 焦點等重抓把它拿掉之後才移,等待期間留在這個空白輸入框,不會掉到 body
  function handleDeleteByKeyboard(item: ChecklistItem) {
    void deleteItem(item, 'previous', true)
  }

  // 寫入排隊中(含初次載入)不能開始拖曳:放下後的樂觀順序會被先完成的寫入的重抓蓋掉,
  // 後送的 PUT 也可能因陣列不吻合被拒
  const isBlocked = useCallback(() => pendingWritesRef.current > 0, [])
  const sensors = useSensors(
    // 移動 5px 才算拖曳,單純點一下把手不會啟動
    useSensor(GuardedPointerSensor, { isBlocked, activationConstraint: { distance: 5 } }),
    useSensor(GuardedKeyboardSensor, { isBlocked, coordinateGetter: sortableKeyboardCoordinates }),
  )
  // 拖曳期間 items 不會變(樂觀更新在放下之後),朗讀文字直接用這次渲染的 items
  const announcements = useMemo(() => checklistAnnouncements(items), [items])

  function focusHandleAfterDrop(id: UniqueIdentifier) {
    focusHandleIdRef.current = Number(id)
    // DOM 節點不會因為換位置而卸載(key = id);等這次拖曳的渲染結束再聚焦
    requestAnimationFrame(() => {
      const target = focusHandleIdRef.current
      focusHandleIdRef.current = null
      if (target !== null) {
        handleRefs.current.get(target)?.focus()
      }
    })
  }

  // 位置沒變就不做事。有變就先直接改 items(樂觀更新,全 app 唯一的樂觀更新),
  // 等回應的話放手時項目會先彈回原位。PUT 排進佇列,成功或失敗都重抓:
  // 成功 = 照常;失敗 = 還原成伺服器的順序
  function handleDragEnd({ active, over }: DragEndEvent) {
    focusHandleAfterDrop(active.id)
    if (over === null || active.id === over.id) {
      return
    }
    const from = items.findIndex((item) => item.id === active.id)
    const to = items.findIndex((item) => item.id === over.id)
    if (from === -1 || to === -1) {
      return
    }
    const next = arrayMove(items, from, to)
    setItems(next)

    void enqueue(async () => {
      try {
        const response = await fetch(`/api/tasks/tasks/${taskId}/checklist-items/order`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: next.map((item) => item.id) }),
        })
        const failure = response.ok ? null : await readApiError(response)
        const refetchFailure = await fetchItems()
        if (failure !== null) {
          onError(messageFor(failure, 'task'))
        } else {
          onError(refetchFailure === null ? null : messageFor(refetchFailure, 'task'))
        }
      } catch {
        onError(generalMessage('NETWORK'))
        // 連線恢復的話還原成伺服器的順序;還是失敗就留著,下一次寫入的重抓會更正
        await fetchItems().catch(() => undefined)
      }
    })
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
    let target: HTMLInputElement | null = null
    if (items.length === 0) {
      target = addInputRef.current
    } else if (pending.prefer === 'previous') {
      // 刪的是第一項(沒有上一項)就落到遞補上來的那一項
      target = inputRefs.current[Math.min(Math.max(pending.index - 1, 0), items.length - 1)]
    } else {
      target = inputRefs.current[Math.min(pending.index, items.length - 1)]
    }
    if (target == null) {
      return
    }
    target.focus()
    if (pending.caretEnd) {
      target.setSelectionRange(target.value.length, target.value.length)
    }
  }, [items])

  return (
    <div className={styles.checklist}>
      {/* 和中欄同一份骨架;不先顯示「載入中…」 */}
      {loading && <TaskListSkeleton />}

      {!loading && !loadFailed && items.length === 0 && (
        <p className={styles.empty}>還沒有檢查項目</p>
      )}

      {items.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{ announcements, screenReaderInstructions }}
          onDragEnd={handleDragEnd}
          onDragCancel={({ active }) => focusHandleAfterDrop(active.id)}
        >
          <SortableContext
            items={items.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className={styles.list} aria-labelledby={labelId}>
              {items.map((item, index) => (
                <ChecklistItemRow
                  key={item.id}
                  item={item}
                  onToggle={(current) => patchItem(current.id, { done: current.completedAt === null })}
                  onRename={(current, title) => patchItem(current.id, { title })}
                  onDelete={handleDelete}
                  onDeleteByKeyboard={handleDeleteByKeyboard}
                  // 行內箭頭函式每次 render 都是新的,React 會重新呼叫,索引跟著當次順序
                  inputRef={(element) => {
                    inputRefs.current[index] = element
                  }}
                  // ChecklistItemRow 把它和 dnd-kit 的 activator ref 合成一個 callback ref,
                  // 卸載時會收到 null
                  handleRef={(element) => {
                    if (element === null) {
                      handleRefs.current.delete(item.id)
                    } else {
                      handleRefs.current.set(item.id, element)
                    }
                  }}
                  errorId={`${errorIdPrefix}-item-${item.id}`}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {/* 載入失敗時不給新增:不知道這個任務還在不在 */}
      {!loading && !loadFailed && (
        <NewChecklistItemForm
          onCreate={handleCreate}
          onCreateMany={handleCreateMany}
          inputRef={addInputRef}
          errorId={`${errorIdPrefix}-new`}
        />
      )}
    </div>
  )
}
