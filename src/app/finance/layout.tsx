import type { Metadata } from 'next'
import FinanceShell from '@/modules/finance/components/FinanceShell'

export const metadata: Metadata = {
  title: 'finance',
  description: '複式簿記記帳',
}

export default function FinanceLayout({ children }: LayoutProps<'/finance'>) {
  return <FinanceShell>{children}</FinanceShell>
}
