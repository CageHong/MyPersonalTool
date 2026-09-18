import { Suspense } from 'react'
import PageSkeleton from '@/components/PageSkeleton'
import ThreeColumnLayout from '@/components/ThreeColumnLayout'

export default function Home() {
  // ThreeColumnLayout 讀 useSearchParams,預先渲染時要有 Suspense 邊界;
  // 邊界以內改走 client render,fallback 是靜態骨架,首屏不留一片空白。
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ThreeColumnLayout />
    </Suspense>
  )
}
