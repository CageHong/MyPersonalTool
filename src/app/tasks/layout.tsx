import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'tasks',
  description: '個人任務管理',
}

export default function TasksLayout({ children }: LayoutProps<'/tasks'>) {
  return children
}
