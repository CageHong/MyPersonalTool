// 收款人文字的正規化。匯入的原始文字先經過這裡,再到別名表做完全相同的比對。

function collapse(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

// 去掉結尾的付款處理商後綴(例:「某商家 via 某處理商」)。suffixes 不含前面的空白,比對不分大小寫
function stripSuffix(text: string, suffixes: readonly string[]): string {
  const lower = text.toLowerCase()
  for (const suffix of suffixes) {
    const tail = ' ' + collapse(suffix).toLowerCase()
    if (tail.length > 1 && lower.length > tail.length && lower.endsWith(tail)) {
      return text.slice(0, text.length - tail.length)
    }
  }
  return text
}

// 別名表的鍵:去頭尾空白、連續空白合成一個、去掉後綴、轉小寫
export function normalizePayeeText(raw: string, suffixes: readonly string[]): string {
  return stripSuffix(collapse(raw), suffixes).toLowerCase()
}

// 第一次看到這個文字時,收款人的顯示名稱:保留原本的大小寫,只整理空白與後綴
export function payeeDisplayName(raw: string, suffixes: readonly string[]): string {
  return stripSuffix(collapse(raw), suffixes)
}
