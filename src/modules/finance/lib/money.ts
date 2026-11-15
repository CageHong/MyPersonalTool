// 最小貨幣單位的整數 → 顯示用文字。只在顯示時換算,不參與任何計算

// 1234567, 2 → "12,345.67";千分位固定用逗號,不跟著瀏覽器語系變
export function formatAmount(amount: number, exponent: number): string {
  const negative = amount < 0
  const digits = String(Math.abs(amount)).padStart(exponent + 1, '0')
  const whole = digits.slice(0, digits.length - exponent).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = exponent ? `.${digits.slice(digits.length - exponent)}` : ''
  return `${negative ? '−' : ''}${whole}${fraction}`
}

export function formatMoney(amount: number, currency: string, exponents: Record<string, number>): string {
  return `${formatAmount(amount, exponents[currency] ?? 0)} ${currency}`
}

// 使用者輸入的金額文字 → 最小貨幣單位的整數。接受千分位逗號與空白;小數位數超過幣別的、不是數字的回傳 null。
// 用字串處理,不經過浮點數
export function parseAmount(text: string, exponent: number): number | null {
  const cleaned = text.replace(/[,\s]/g, '')
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned)
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) return null
  const [, sign, whole, fraction = ''] = match
  if (fraction.length > exponent) return null
  const units = Number(whole || '0') * 10 ** exponent + Number(fraction.padEnd(exponent, '0') || '0')
  if (!Number.isSafeInteger(units)) return null
  return sign ? -units : units
}

// 最小貨幣單位的整數 → 輸入框的文字(沒有千分位,負號用 -)
export function amountInputValue(amount: number, exponent: number): string {
  return formatAmount(Math.abs(amount), exponent).replace(/,/g, '').replace(/^/, amount < 0 ? '-' : '')
}
