import { useState } from 'react'

export type Draft = {
  value: string
  onFocus: () => void
  onChange: (next: string) => void
  onBlur: () => void
}

// 編輯中的輸入框不被重抓覆蓋:聚焦期間值由 draft 持有,失焦後才跟回伺服器資料。
// 值是字串,null 之類的空值語意由呼叫端在兩端換算。
export function useDraft(serverValue: string, save: (value: string) => Promise<boolean>): Draft {
  // null = 沒在編輯
  const [draft, setDraft] = useState<string | null>(null)

  async function blur() {
    // 值沒變就不送 PATCH
    if (draft === null || draft === serverValue) {
      setDraft(null)
      return
    }

    // 等 PATCH 與重抓都結束才放掉 draft:成功時畫面不會閃一下舊值,
    // 失敗時(例如標題清空被擋)放掉正好還原成伺服器的值
    await save(draft)
    setDraft(null)
  }

  return {
    value: draft ?? serverValue,
    onFocus: () => setDraft(serverValue),
    onChange: setDraft,
    onBlur: () => void blur(),
  }
}
