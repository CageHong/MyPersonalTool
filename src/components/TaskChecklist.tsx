import { useCallback, useEffect, useId, useRef, useState } from 'react'
import ChecklistDraftRow from './ChecklistDraftRow'
import ChecklistItemRow from './ChecklistItemRow'
import NewChecklistItemForm from './NewChecklistItemForm'
import TaskListSkeleton from './TaskListSkeleton'
import {
  buildChecklistRows,
  type ChecklistDraft,
  type ChecklistItem,
  type ChecklistItemPatch,
  type ChecklistRow,
  type DraftAnchor,
} from '@/lib/checklist'
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

// 焦點的目標:正式項目、草稿列或底部新增列。caret: 'end' = 游標放在文字末尾
type FocusTarget =
  | { kind: 'item'; id: number }
  | { kind: 'draft'; key: string }
  | { kind: 'add' }

function rowTarget(row: ChecklistRow | undefined): FocusTarget | null {
  if (row === undefined) {
    return null
  }
  return row.kind === 'item'
    ? { kind: 'item', id: row.item.id }
    : { kind: 'draft', key: row.draft.key }
}

let draftSequence = 0
function newDraftKey(): string {
  draftSequence += 1
  return `draft-${draftSequence}`
}

// 狀態全在這一層:TaskDetail 以 key={task.id} 掛載,換任務時項目、草稿、佇列一起清掉
export default function TaskChecklist({ taskId, onError, labelId }: Props) {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [drafts, setDrafts] = useState<ChecklistDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const errorIdPrefix = useId()

  // 寫入排隊:每個動作等前一個(含重抓)結束才開始,所以不必停用任何控制項。
  // 例:編輯中直接點刪除鈕,失焦觸發的儲存先排進去,刪除排在它後面,兩個都會執行
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  // 排隊的 job 執行時才讀的最新資料。都在事件或 job 裡同步寫入,不等 render:
  // 前一個 job 結束、下一個開始時,React 不一定已經重新渲染
  const itemsRef = useRef<ChecklistItem[]>([])
  // 草稿 key → 它的錨點;建立失敗時,後面接著的草稿要往上找這個錨點
  const draftAnchorsRef = useRef(new Map<string, DraftAnchor>())
  // 草稿 key → 建立出來的項目 id;只拿來當下一個草稿的 afterItemId,清單仍由重抓替換
  const createdIdsRef = useRef(new Map<string, number>())
  // 已送出的草稿;Enter 送出後焦點移走會觸發失焦,不能再送一次
  const submittedKeysRef = useRef(new Set<string>())

  const itemInputRefs = useRef(new Map<number, HTMLInputElement>())
  const draftInputRefs = useRef(new Map<string, HTMLInputElement>())
  const addInputRef = useRef<HTMLInputElement>(null)

  // 渲染後才能聚焦的目標(新掛上的草稿列、剛建立的正式項目)
  const focusRequestRef = useRef<{ target: FocusTarget; caretEnd: boolean } | null>(null)
  // 刪除後的焦點:等重抓把項目拿掉之後,依序找還在畫面上的候選,都不在就落到新增列
  const focusAfterDeleteRef = useRef<{
    id: number
    candidates: FocusTarget[]
    caretEnd: boolean
  } | null>(null)

  const rows = buildChecklistRows(items, drafts)

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
    const next = (await response.json()) as ChecklistItem[]
    itemsRef.current = next
    setItems(next)
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

  function elementFor(target: FocusTarget): HTMLInputElement | null {
    if (target.kind === 'add') {
      return addInputRef.current
    }
    return (
      (target.kind === 'item'
        ? itemInputRefs.current.get(target.id)
        : draftInputRefs.current.get(target.key)) ?? null
    )
  }

  function focusElement(element: HTMLInputElement, caretEnd: boolean) {
    element.focus()
    if (caretEnd) {
      element.setSelectionRange(element.value.length, element.value.length)
    }
  }

  // 焦點都在渲染之後處理:新掛上的元素這時才有 ref,被刪掉的元素這時才真的不在
  useEffect(() => {
    const pendingDelete = focusAfterDeleteRef.current
    if (pendingDelete !== null && !items.some((item) => item.id === pendingDelete.id)) {
      focusAfterDeleteRef.current = null
      // 等待期間使用者已經把焦點放到別處(不是被刪掉的元素留下的 body)就不搶
      if (document.activeElement === null || document.activeElement === document.body) {
        const element =
          pendingDelete.candidates.map(elementFor).find((candidate) => candidate !== null) ??
          addInputRef.current
        if (element !== null) {
          focusElement(element, pendingDelete.caretEnd)
        }
      }
    }

    const request = focusRequestRef.current
    if (request !== null) {
      const element = elementFor(request.target)
      if (element !== null) {
        focusRequestRef.current = null
        focusElement(element, request.caretEnd)
      }
    }
  }, [items, drafts])

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

  // 底部新增列:放在最後
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

  function deleteItem(item: ChecklistItem, candidates: FocusTarget[], caretEnd: boolean) {
    focusAfterDeleteRef.current = { id: item.id, candidates, caretEnd }
    void write(() => fetch(`/api/checklist-items/${item.id}`, { method: 'DELETE' }), 'item').then(
      (failure) => {
        if (failure !== null) {
          focusAfterDeleteRef.current = null
        }
      },
    )
  }

  function neighbors(index: number): { previous: FocusTarget | null; next: FocusTarget | null } {
    return { previous: rowTarget(rows[index - 1]), next: rowTarget(rows[index + 1]) }
  }

  // 刪除鈕:同任務刪除的規則(docs/decisions.md §5),遞補上來的那一項優先
  function handleDeleteButton(item: ChecklistItem) {
    const index = rows.findIndex((row) => row.kind === 'item' && row.item.id === item.id)
    const { previous, next } = neighbors(index)
    deleteItem(item, [next, previous].filter((target) => target !== null), false)
    return Promise.resolve(null)
  }

  // 空白項目按 Backspace:回到上一項的末尾接著打;刪的是第一項就到下一項。
  // 焦點等重抓把它拿掉之後才移,等待期間留在這個空白輸入框,不會掉到 body
  function handleDeleteByKeyboard(item: ChecklistItem) {
    const index = rows.findIndex((row) => row.kind === 'item' && row.item.id === item.id)
    const { previous, next } = neighbors(index)
    deleteItem(item, [previous, next].filter((target) => target !== null), true)
  }

  // 在錨點正下方新增一個空白草稿並聚焦。放在陣列最前面:同一個錨點下,新開的緊貼著錨點
  function openDraftBelow(anchor: DraftAnchor) {
    const key = newDraftKey()
    draftAnchorsRef.current.set(key, anchor)
    focusRequestRef.current = { target: { kind: 'draft', key }, caretEnd: false }
    setDrafts((current) => [{ key, anchor, value: '', status: 'editing' }, ...current])
  }

  function removeDraft(key: string) {
    draftAnchorsRef.current.delete(key)
    setDrafts((current) => current.filter((draft) => draft.key !== key))
  }

  // job 執行時才決定 afterItemId:錨點草稿已建立就用它的 id,建立失敗就往上找它的錨點。
  // 錨點項目已經不在清單裡就不帶(放最後),和畫面上「錨點不見的草稿接在最後」一致
  function resolveAfterItemId(anchor: DraftAnchor | undefined): number | undefined {
    let current = anchor
    while (current !== undefined && current.kind === 'draft') {
      const createdId = createdIdsRef.current.get(current.key)
      current =
        createdId === undefined
          ? draftAnchorsRef.current.get(current.key)
          : { kind: 'item', id: createdId }
    }
    if (current === undefined) {
      return undefined
    }
    const anchorId = current.id
    return itemsRef.current.some((item) => item.id === anchorId) ? anchorId : undefined
  }

  // 草稿送出:Enter(openNext = true,連續輸入)或有字的失焦(openNext = false)
  function submitDraft(draft: ChecklistDraft, openNext: boolean) {
    if (submittedKeysRef.current.has(draft.key)) {
      return
    }
    submittedKeysRef.current.add(draft.key)
    const title = draft.value

    setDrafts((current) =>
      current.map((entry) => (entry.key === draft.key ? { ...entry, status: 'pending' } : entry)),
    )
    if (openNext) {
      openDraftBelow({ kind: 'draft', key: draft.key })
    }

    void enqueue(async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}/checklist-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            afterItemId: resolveAfterItemId(draftAnchorsRef.current.get(draft.key)),
          }),
        })
        if (!response.ok) {
          const failure = await readApiError(response)
          onError(messageFor(failure, 'task'))
          // 文字留著,改回可編輯;使用者再按 Enter 或失焦就會重送
          submittedKeysRef.current.delete(draft.key)
          setDrafts((current) =>
            current.map((entry) =>
              entry.key === draft.key ? { ...entry, status: 'editing' } : entry,
            ),
          )
          return
        }

        const created = (await response.json()) as ChecklistItem
        createdIdsRef.current.set(draft.key, created.id)
        const refetchFailure = await fetchItems()
        onError(refetchFailure === null ? null : messageFor(refetchFailure, 'task'))

        // 焦點還在這個草稿上(例:下一個空白草稿按 Backspace 又回到它)就交給正式項目,
        // 不然草稿卸載時焦點會掉到 body
        if (document.activeElement === draftInputRefs.current.get(draft.key)) {
          focusRequestRef.current = { target: { kind: 'item', id: created.id }, caretEnd: true }
        }
        // 和 setItems 同一次 render 生效:正式項目出現的同時草稿消失,中間不閃。
        // 接在它後面的草稿改成接在正式項目後面
        const createdAnchor: DraftAnchor = { kind: 'item', id: created.id }
        for (const [key, anchor] of draftAnchorsRef.current) {
          if (anchor.kind === 'draft' && anchor.key === draft.key) {
            draftAnchorsRef.current.set(key, createdAnchor)
          }
        }
        draftAnchorsRef.current.delete(draft.key)
        setDrafts((current) =>
          current
            .filter((entry) => entry.key !== draft.key)
            .map((entry) =>
              entry.anchor.kind === 'draft' && entry.anchor.key === draft.key
                ? { ...entry, anchor: createdAnchor }
                : entry,
            ),
        )
      } catch {
        onError(generalMessage('NETWORK'))
        if (createdIdsRef.current.has(draft.key)) {
          // 已經建立成功,只是重抓失敗:草稿不能改回可編輯,不然會重複建立
          removeDraft(draft.key)
        } else {
          submittedKeysRef.current.delete(draft.key)
          setDrafts((current) =>
            current.map((entry) =>
              entry.key === draft.key ? { ...entry, status: 'editing' } : entry,
            ),
          )
        }
      }
    })
  }

  function handleDraftBlur(draft: ChecklistDraft) {
    if (submittedKeysRef.current.has(draft.key)) {
      return
    }
    if (draft.value.trim() === '') {
      removeDraft(draft.key)
      return
    }
    submitDraft(draft, false)
  }

  // 空白草稿按 Backspace:移除,回到畫面上它的上一列末尾
  function handleDraftBackspace(draft: ChecklistDraft, index: number) {
    const previous = rowTarget(rows[index - 1])
    const element = previous === null ? null : elementFor(previous)
    if (element !== null) {
      focusElement(element, true)
    }
    removeDraft(draft.key)
  }

  return (
    <div className={styles.checklist}>
      {/* 和中欄同一份骨架;不先顯示「載入中…」 */}
      {loading && <TaskListSkeleton />}

      {!loading && !loadFailed && rows.length === 0 && (
        <p className={styles.empty}>還沒有檢查項目</p>
      )}

      {rows.length > 0 && (
        <ul className={styles.list} aria-labelledby={labelId}>
          {rows.map((row, index) =>
            row.kind === 'item' ? (
              <ChecklistItemRow
                key={`item-${row.item.id}`}
                item={row.item}
                onToggle={(item) => patchItem(item.id, { done: item.completedAt === null })}
                onRename={(item, title) => patchItem(item.id, { title })}
                onDelete={handleDeleteButton}
                onInsertBelow={(item) => openDraftBelow({ kind: 'item', id: item.id })}
                onDeleteByKeyboard={handleDeleteByKeyboard}
                inputRef={(element) => {
                  if (element === null) {
                    return
                  }
                  const id = row.item.id
                  itemInputRefs.current.set(id, element)
                  return () => {
                    itemInputRefs.current.delete(id)
                  }
                }}
                errorId={`${errorIdPrefix}-item-${row.item.id}`}
              />
            ) : (
              <ChecklistDraftRow
                key={row.draft.key}
                draft={row.draft}
                onChange={(value) =>
                  setDrafts((current) =>
                    current.map((entry) =>
                      entry.key === row.draft.key ? { ...entry, value } : entry,
                    ),
                  )
                }
                onEnter={() => {
                  // 空白草稿按 Enter 不做事
                  if (row.draft.value.trim() !== '') {
                    submitDraft(row.draft, true)
                  }
                }}
                onBlur={() => handleDraftBlur(row.draft)}
                onBackspaceEmpty={() => handleDraftBackspace(row.draft, index)}
                inputRef={(element) => {
                  if (element === null) {
                    return
                  }
                  const key = row.draft.key
                  draftInputRefs.current.set(key, element)
                  return () => {
                    draftInputRefs.current.delete(key)
                  }
                }}
              />
            ),
          )}
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
