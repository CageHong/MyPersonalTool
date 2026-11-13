// 十進位字串的處理。金額在這個套件裡一律是字串,不轉成浮點數。

const DECIMAL = /^\d+(\.\d+)?$/

// 不帶正負號的十進位字串(例:'12.30');不接受千分位、指數、空字串
export function isUnsignedDecimal(text: string): boolean {
  return DECIMAL.test(text)
}

export function isZeroDecimal(text: string): boolean {
  return /^0+(\.0+)?$/.test(text)
}

// 同一個數值只有一種寫法:去掉整數部分開頭多餘的 0、小數部分結尾的 0。輸入可以帶負號
export function canonicalDecimal(text: string): string {
  const negative = text.startsWith('-')
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.')
  const wholePart = whole.replace(/^0+(?=\d)/, '')
  const fractionPart = fraction.replace(/0+$/, '')
  const magnitude = fractionPart === '' ? wholePart : `${wholePart}.${fractionPart}`
  return negative && !isZeroDecimal(magnitude) ? `-${magnitude}` : magnitude
}
