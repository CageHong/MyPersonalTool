import { Suspense } from 'react'
import ThreeColumnLayout from '@/components/ThreeColumnLayout'

export default function Home() {
  // ThreeColumnLayout 讀 useSearchParams,預先渲染時要有 Suspense 邊界;
  // 邊界以內改走 client render,fallback 不特別畫東西。
  return (
    <Suspense fallback={null}>
      <ThreeColumnLayout />
    </Suspense>
  )
}
