import { Suspense } from 'react'
import PayeesPage from '@/modules/finance/components/PayeesPage'

export default function FinancePayees() {
  // PayeesPage 讀 useSearchParams(排序),預先渲染時要有 Suspense 邊界
  return (
    <Suspense fallback={null}>
      <PayeesPage />
    </Suspense>
  )
}
