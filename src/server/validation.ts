// src/server/ 各模組共用的驗證常數

// 日曆日,YYYY-MM-DD
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// 無 / 低 / 中 / 高;刻意留空隙,之後插一級不動既有資料
export const PRIORITY_VALUES: readonly number[] = [0, 1, 3, 5]
