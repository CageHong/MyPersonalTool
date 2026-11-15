import { redirect } from 'next/navigation'

// /finance 的預設頁是交易清單
export default function FinanceHome() {
  redirect('/finance/transactions')
}
