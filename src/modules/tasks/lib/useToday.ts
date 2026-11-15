import { useEffect, useState } from 'react'
import { msUntilNextLocalMidnight, todayIso } from './date'

// 今天的 YYYY-MM-DD。跨過本地午夜時自動更新,分頁從背景回來時也重算一次(電腦睡眠時計時器不可靠)
export function useToday(): string {
  const [today, setToday] = useState(todayIso)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    function schedule() {
      timer = setTimeout(() => {
        setToday(todayIso())
        schedule()
      }, msUntilNextLocalMidnight(new Date()))
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        setToday(todayIso())
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
