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
