// 帳本改了(新增、編輯、刪除交易,匯入,帳戶管理)時通知同一個分頁裡的其他畫面,例如側欄重新取餘額。
// 只在瀏覽器裡用;不跨分頁
const EVENT = 'finance:ledger-changed'

export function notifyLedgerChanged(): void {
  window.dispatchEvent(new Event(EVENT))
}

export function onLedgerChanged(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
