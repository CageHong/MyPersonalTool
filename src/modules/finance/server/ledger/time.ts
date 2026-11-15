// 帳本存時間的格式:UTC、精確到秒、結尾 +00:00
export function toStoredTimestamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19) + '+00:00'
}
