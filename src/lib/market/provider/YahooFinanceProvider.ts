import { MarketDataProvider } from './MarketDataProvider'
import { Stock, NormalizedQuote, TradingCalendar, HistoricalBar } from '../models'
import { z } from 'zod'
import { getCurrentTradingDate, getMarketTimezone, isMarketOpen } from '../sessions'

/**
 * Real Indian market data via Yahoo Finance.
 *
 * NSE listings are addressed with a `.NS` suffix (RELIANCE → RELIANCE.NS),
 * no API key required. Each call hits the v8 chart endpoint with a 1-year
 * daily range, which is everything the detection engine needs:
 *
 *   • `meta`                → live price, volume, timestamp, previous close
 *   • daily high/low series → true 52-week high / low (cross-checked against meta)
 *   • daily volume series   → 20-day average volume, the RVOL baseline
 *
 * Responses are validated with Zod so an upstream payload change surfaces as a
 * parse failure for one symbol instead of corrupting stored state.
 */

const NS_SUFFIX = '.NS'
const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart'
/**
 * Yahoo's edge (ATS) rate-limits this endpoint with HTTP 429 — and, empirically,
 * it rejects BOTH full Chrome user-agents and curl's default UA from this
 * network while accepting a bare `Mozilla/5.0`. Keep this short UA; do not
 * "upgrade" it to a full browser string (verified 2026-09: long UA → 429,
 * `Mozilla/5.0` → 200 for identical requests seconds apart).
 */
const USER_AGENT = 'Mozilla/5.0'
/**
 * Yahoo rate-limits bursts with HTTP 429 (no Retry-After header), so quotes are
 * fetched strictly one at a time with a polite gap, and each request retries
 * with exponential backoff before giving up on a symbol.
 */
const REQUEST_DELAY_MS = 1_000
const MAX_ATTEMPTS = 4
const RETRY_BASE_DELAY_MS = 2_000

/** Top NSE large caps used as the tracked universe (order ≈ weight). */
const NSE_UNIVERSE: { symbol: string; name: string; sector: string }[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy' },
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'Information Technology' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Financials' },
  { symbol: 'INFY', name: 'Infosys', sector: 'Information Technology' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Financials' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Communication Services' },
  { symbol: 'ITC', name: 'ITC', sector: 'Consumer Staples' },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Financials' },
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'Industrials' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'Financials' },
  { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'Financials' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki India', sector: 'Consumer Discretionary' },
  // TATAMOTORS.NS returns 404 post-demerger — Tata Steel is the liquid large-cap substitute.
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'Materials' },
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical Industries', sector: 'Health Care' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'Consumer Staples' },
  { symbol: 'TITAN', name: 'Titan Company', sector: 'Consumer Discretionary' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'Financials' },
  { symbol: 'NTPC', name: 'NTPC', sector: 'Utilities' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', sector: 'Materials' },
  { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'Information Technology' },
]

const chartMetaSchema = z.object({
  symbol: z.string(),
  currency: z.string().optional(),
  fullExchangeName: z.string().optional(),
  regularMarketPrice: z.number().optional(),
  regularMarketVolume: z.number().optional(),
  regularMarketTime: z.number().optional(),
  previousClose: z.number().optional(),
  chartPreviousClose: z.number().optional(),
  fiftyTwoWeekHigh: z.number().optional(),
  fiftyTwoWeekLow: z.number().optional(),
})

const chartResponseSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: chartMetaSchema,
          timestamp: z.array(z.number().nullable()).optional(),
          indicators: z.unknown().optional(),
        })
      )
      .optional(),
    error: z.unknown().optional(),
  }),
})

type DailySeries = {
  open: number[]
  high: number[]
  low: number[]
  close: number[]
  volume: number[]
}

const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class YahooFinanceProvider implements MarketDataProvider {
  private yahooSymbol(symbol: string): string {
    return symbol.endsWith(NS_SUFFIX) ? symbol : `${symbol}${NS_SUFFIX}`
  }

  async getStocks(): Promise<Stock[]> {
    const limit = Number(process.env.MAX_TRACKED_SYMBOLS || '20')
    return NSE_UNIVERSE.slice(0, limit).map((s) => ({
      symbol: s.symbol,
      name: s.name,
      exchange: 'NSE',
      country: 'IN',
      sector: s.sector,
      currency: 'INR',
      assetType: 'EQ',
      isActive: true,
    }))
  }

  async getQuote(symbol: string): Promise<NormalizedQuote | null> {
    return this.fetchQuote(symbol)
  }

  async getQuotes(symbols: string[]): Promise<NormalizedQuote[]> {
    const quotes: NormalizedQuote[] = []
    for (const symbol of symbols) {
      const quote = await this.fetchQuote(symbol)
      if (quote) quotes.push(quote)
      await sleep(REQUEST_DELAY_MS)
    }
    return quotes
  }

  private async fetchChart(yahooSymbol: string, rangeQuery: string): Promise<z.infer<typeof chartResponseSchema> | null> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(`${CHART_URL}/${encodeURIComponent(yahooSymbol)}?${rangeQuery}`, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          cache: 'no-store',
        })

        if (res.status === 429 && attempt < MAX_ATTEMPTS) {
          const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
          console.warn(`[yahoo] ${yahooSymbol} rate-limited (429) — retrying in ${backoff}ms`)
          await sleep(backoff)
          continue
        }
        if (!res.ok) {
          console.warn(`[yahoo] ${yahooSymbol} responded ${res.status}`)
          return null
        }

        const parsed = chartResponseSchema.safeParse(await res.json())
        if (!parsed.success) {
          console.warn(`[yahoo] ${yahooSymbol} payload failed validation:`, parsed.error.issues[0]?.message)
          return null
        }
        return parsed.data
      } catch (err) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
          continue
        }
        console.warn(`[yahoo] ${yahooSymbol} request failed:`, err instanceof Error ? err.message : err)
        return null
      }
    }
    return null
  }

  private extractSeries(payload: z.infer<typeof chartResponseSchema>): { meta: z.infer<typeof chartMetaSchema>; series: DailySeries; timestamps: number[] } | null {
    const result = payload.chart.result?.[0]
    if (!result) return null

    const rawQuote = (result.indicators as { quote?: Array<Record<string, Array<number | null>>> } | undefined)?.quote?.[0]
    const toNumbers = (values: Array<number | null> | undefined) => (values ?? []).filter(finite)

    const series: DailySeries = {
      open: toNumbers(rawQuote?.open),
      high: toNumbers(rawQuote?.high),
      low: toNumbers(rawQuote?.low),
      close: toNumbers(rawQuote?.close),
      volume: toNumbers(rawQuote?.volume),
    }
    const timestamps = (result.timestamp ?? []).filter(finite)

    return { meta: result.meta, series, timestamps }
  }

  private async fetchQuote(symbol: string): Promise<NormalizedQuote | null> {
    const yahooSymbol = this.yahooSymbol(symbol)
    const payload = await this.fetchChart(yahooSymbol, 'range=1y&interval=1d&includePrePost=false')
    if (!payload) return null

    const extracted = this.extractSeries(payload)
    if (!extracted) {
      console.warn(`[yahoo] no chart data for ${yahooSymbol}`)
      return null
    }

    const { meta, series, timestamps } = extracted
    const price = meta.regularMarketPrice ?? series.close.at(-1)
    if (price === undefined) return null

    // True 52-week bounds: meta values cross-checked against the daily series.
    const highs = series.high.length ? series.high : [price]
    const lows = series.low.length ? series.low : [price]
    const week52High = Math.max(meta.fiftyTwoWeekHigh ?? -Infinity, ...highs)
    const week52Low = Math.min(meta.fiftyTwoWeekLow ?? Infinity, ...lows)

    // RVOL baseline: mean volume over the last 20 sessions.
    const recentVolumes = series.volume.slice(-20)
    const averageVolume = recentVolumes.length
      ? recentVolumes.reduce((sum, v) => sum + v, 0) / recentVolumes.length
      : undefined

    const lastStamp = timestamps.at(-1)

    return {
      symbol,
      price,
      volume: meta.regularMarketVolume ?? series.volume.at(-1),
      averageVolume,
      previousClose: meta.previousClose ?? meta.chartPreviousClose,
      week52High: Number.isFinite(week52High) ? week52High : price,
      week52Low: Number.isFinite(week52Low) && week52Low > 0 ? week52Low : price,
      timestamp: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000)
        : lastStamp
          ? new Date(lastStamp * 1000)
          : new Date(),
      exchange: meta.fullExchangeName || 'NSE',
      currency: meta.currency || 'INR',
    }
  }

  async getTradingCalendar(): Promise<TradingCalendar> {
    const open = isMarketOpen()
    return {
      isOpen: open,
      session: open ? 'OPEN' : 'CLOSED',
      nextOpen: null,
      nextClose: null,
      tradingDate: getCurrentTradingDate(),
      timezone: getMarketTimezone(),
    }
  }

  async getHistoricalData(symbol: string, startDate: string, endDate: string): Promise<HistoricalBar[]> {
    const start = Date.parse(startDate)
    const end = Date.parse(endDate)
    if (Number.isNaN(start) || Number.isNaN(end)) return []

    const payload = await this.fetchChart(
      this.yahooSymbol(symbol),
      `period1=${Math.floor(start / 1000)}&period2=${Math.floor(end / 1000)}&interval=1d`
    )
    const extracted = payload ? this.extractSeries(payload) : null
    if (!extracted) return []

    const { series, timestamps } = extracted
    return timestamps.flatMap((ts, i) => {
      const open = series.open[i]
      const high = series.high[i]
      const low = series.low[i]
      const close = series.close[i]
      const volume = series.volume[i]
      if (open === undefined || high === undefined || low === undefined || close === undefined) return []
      return [{ timestamp: new Date(ts * 1000), open, high, low, close, volume: volume ?? 0 }]
    })
  }
}
