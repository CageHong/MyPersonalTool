import { redirect } from 'next/navigation'

// 交易清單做好之前,/finance 先到匯入
export default function FinanceHome() {
  redirect('/finance/import')
}
