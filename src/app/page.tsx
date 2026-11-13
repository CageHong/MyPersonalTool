import { redirect } from 'next/navigation'

// 平台沒有首頁:每個工具在自己的路徑底下(/tasks、/finance),根路徑先導到任務管理
export default function Home() {
  redirect('/tasks')
}
