import { useEffect, useState } from 'react'
import { localDate } from '@/platform/date'
import { msUntilNextLocalMidnight } from './date'

// 今天的 YYYY-MM-DD。跨過本地午夜時自動更新,分頁從背景回來時也重算一次(電腦睡眠時計時器不可靠)
export function useToday(): string {
  const [today, setToday] = useState(() => localDate(new Date()))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    function schedule() {
      timer = setTimeout(() => {
        setToday(localDate(new Date()))
        schedule()
      }, msUntilNextLocalMidnight(new Date()))
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        setToday(localDate(new Date()))
        clearTimeout(timer)
        schedule()
      }
    }

    schedule()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return today
}
