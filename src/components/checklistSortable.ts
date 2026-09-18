import {
  KeyboardSensor,
  type Activators,
  PointerSensor,
  type Announcements,
  type KeyboardSensorOptions,
  type PointerSensorOptions,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import type { ChecklistItem } from '@/lib/checklist'

// 寫入排隊中不能開始拖曳:感應器在按下的當下問一次 isBlocked(),是 true 就不啟動。
// 這是 dnd-kit 的啟動判斷,不是 DOM 的 disabled 屬性,把手照常可以聚焦、可以點。
// isBlocked 在型別上是可選的,才能相容父類別的 activators 型別;實際使用時一律傳入
type Guard = { isBlocked?: () => boolean }

export class GuardedPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (event: React.PointerEvent, options: PointerSensorOptions & Guard) =>
        options.isBlocked?.() === true ? false : PointerSensor.activators[0].handler(event, options),
    },
  ]
}

export class GuardedKeyboardSensor extends KeyboardSensor {
  static activators: Activators<KeyboardSensorOptions & Guard> = [
    {
      eventName: 'onKeyDown',
      handler: (event, options, context) =>
        options.isBlocked?.() === true
          ? false
          : KeyboardSensor.activators[0].handler(event, options, context),
    },
  ]
}

export const screenReaderInstructions: ScreenReaderInstructions = {
  draggable: '按空白鍵或 Enter 拿起項目,用上下方向鍵移動,再按空白鍵或 Enter 放下,按 Esc 取消。',
}

// 朗讀文字用項目文字與畫面上的位置(從 1 起算);拖曳期間 items 還是放下前的順序
export function checklistAnnouncements(items: ChecklistItem[]): Announcements {
  function title(id: UniqueIdentifier): string {
    return items.find((item) => item.id === id)?.title ?? ''
  }
  function position(id: UniqueIdentifier): number {
    return items.findIndex((item) => item.id === id) + 1
  }

  return {
    onDragStart({ active }) {
      return `已拿起「${title(active.id)}」,目前在第 ${position(active.id)} 項,共 ${items.length} 項。`
    },
    onDragOver({ active, over }) {
      return over === null
        ? `「${title(active.id)}」不在清單範圍內。`
        : `「${title(active.id)}」移到第 ${position(over.id)} 項。`
    },
    onDragEnd({ active, over }) {
      return over === null || over.id === active.id
        ? `「${title(active.id)}」放回原位。`
        : `「${title(active.id)}」放在第 ${position(over.id)} 項。`
    },
    onDragCancel({ active }) {
      return `已取消拖曳,「${title(active.id)}」回到原位。`
    },
  }
}
