import { Suspense } from 'react'
import TransactionsPage from '@/modules/finance/components/TransactionsPage'

export default function FinanceTransactions() {
  // TransactionsPage 讀 useSearchParams,預先渲染時要有 Suspense 邊界
  return (
    <Suspense fallback={null}>
      <TransactionsPage />
    </Suspense>
  )
}
