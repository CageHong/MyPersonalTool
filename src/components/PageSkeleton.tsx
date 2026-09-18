import TaskListSkeleton from './TaskListSkeleton'
import layout from './ThreeColumnLayout.module.css'

// client bundle 跑起來之前的首屏。欄寬、內距、欄底色沿用 ThreeColumnLayout.module.css
// 的同一組 class,不抄數值,換成實際畫面時版面不會跳。
// 靜態內容:不讀 Date、不讀 useSearchParams、不用亂數,hydration 不會不一致
export default function PageSkeleton() {
  return (
    <div className={layout.layout}>
      <section className={`${layout.column} ${layout.categories}`} />
      <section className={`${layout.column} ${layout.tasks}`}>
        <TaskListSkeleton />
      </section>
      <section className={`${layout.column} ${layout.detail}`} />
    </div>
  )
}
