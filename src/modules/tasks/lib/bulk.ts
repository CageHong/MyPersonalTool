// 批次貼上新增(docs/tasks/decisions.md §6f)。中欄新增列與 checklist 新增列共用同一份解析,
// 差別只在輸出端(建立任務或建立檢查項目)

// 一次最多建立幾筆;超過就不當成批次,避免誤貼一整份文件
export const BULK_MAX_LINES = 100

// 行首的清單標記:- * • 、1. 1) 、[ ] [x];可以疊在一起(「- [ ] 買牛奶」)
const MARKER = /^(?:[-*•](?:\s+|$)|\d+[.)](?:\s+|$)|\[[ xX]?\]\s*)/

function stripMarkers(line: string): string {
  let text = line.trim()
  for (;;) {
    const next = text.replace(MARKER, '').trimStart()
    if (next === text) {
      return text
    }
    text = next
  }
}

// 以換行切開,逐行剝掉縮排與清單標記,去掉空行。
// 不猜結構:沒有「無標記的首行是父任務」這種規則,每一行就是一筆
export function parseBulkLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map(stripMarkers)
    .filter((line) => line !== '')
}

// 確認框按取消時的結果:整段當成一個標題。輸入框是單行,換行換成空白
export function joinAsSingleLine(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
}
