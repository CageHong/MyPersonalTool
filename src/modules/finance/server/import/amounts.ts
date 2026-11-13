// 十進位字串 → 最小貨幣單位的整數。小數位數由幣別表(finance_currencies.exponent)決定,這裡不自己定義。

export class AmountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AmountError'
  }
}

const SIGNED_DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/

// 例:('12.30', 2) → 1230;('-5', 0) → -5。
// 小數位數比幣別的位數多、而且多出來的不是 0 時丟錯誤,不四捨五入
export function toMinorUnits(decimal: string, exponent: number): number {
  const match = SIGNED_DECIMAL.exec(decimal)
  if (!match) throw new AmountError(`不是十進位數字:${decimal}`)
  const [, sign, whole, fraction = ''] = match
  if (/[1-9]/.test(fraction.slice(exponent))) {
    throw new AmountError(`${decimal} 的小數位數超過這個幣別的 ${exponent} 位`)
  }
  const digits = whole + fraction.slice(0, exponent).padEnd(exponent, '0')
  const value = Number(digits)
  if (!Number.isSafeInteger(value)) throw new AmountError(`金額太大:${decimal}`)
  return sign === '-' && value !== 0 ? -value : value
}
