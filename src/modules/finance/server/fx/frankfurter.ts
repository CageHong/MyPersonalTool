// 匯率來源:Frankfurter v2(https://frankfurter.dev)。不用金鑰;以歐元為基準一次抓一段期間。
// 這個檔只負責「發請求、把回應轉成我們的格式」,不碰資料庫。

export type SourceRate = {
  // YYYY-MM-DD
  date: string
  currency: string
  // 1 單位 currency = rateToEur 歐元
  rateToEur: number
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export const FRANKFURTER_SOURCE = 'frankfurter'

const ENDPOINT = 'https://api.frankfurter.dev/v2/rates'

// 回應是一個陣列,每列是「1 EUR = rate 單位 quote」;我們存反方向,所以取倒數
export function parseFrankfurterRates(body: unknown): SourceRate[] {
  if (!Array.isArray(body)) {
    throw new Error('Frankfurter:回應不是陣列')
  }
  return body.map((row) => {
    const { date, base, quote, rate } = row as Record<string, unknown>
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      base !== 'EUR' ||
      typeof quote !== 'string' ||
      typeof rate !== 'number' ||
      !(rate > 0)
    ) {
      throw new Error(`Frankfurter:看不懂的資料列 ${JSON.stringify(row)}`)
    }
    return { date, currency: quote, rateToEur: 1 / rate }
  })
}

// 抓 [from, to] 之間每一天的匯率;to 不給 = 到最新一天
export async function fetchFrankfurterRates(
  options: { currencies: readonly string[]; from: string; to?: string },
  fetchFn: FetchLike,
): Promise<SourceRate[]> {
  const params = new URLSearchParams({
    base: 'EUR',
    quotes: options.currencies.join(','),
    from: options.from,
  })
  if (options.to) params.set('to', options.to)
  const response = await fetchFn(`${ENDPOINT}?${params}`)
  if (!response.ok) {
    throw new Error(`Frankfurter:HTTP ${response.status}`)
  }
  return parseFrankfurterRates(await response.json())
}
