import type { ComponentProps } from 'react'
import type { PriorityLevel } from '@/modules/tasks/lib/tasks'
import styles from './Checkbox.module.css'

// 自繪的原生 checkbox:空白鍵、Tab、焦點照舊,外觀由 CSS 畫。
// tone = 優先級顏色(未勾選時的框線與淡填底);不帶就是無優先級的樣式
type Props = Omit<ComponentProps<'input'>, 'type' | 'className'> & {
  tone?: PriorityLevel['tone']
}

export default function Checkbox({ tone, ...inputProps }: Props) {
  return (
    <input
      type="checkbox"
      className={tone === undefined ? styles.checkbox : `${styles.checkbox} ${styles[tone]}`}
      {...inputProps}
    />
  )
}
