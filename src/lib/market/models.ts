export type Stock = {
  symbol: string
  name: string
  exchange: string
  country?: string
  sector?: string
  industry?: string
  currency?: string
  assetType?: string
  isActive: boolean
}

export type NormalizedQuote = {
  symbol: string
  price: number
  volume?: number
  /** Rolling average volume (e.g. 20-day) used as the RVOL baseline. */
  averageVolume?: number
  previousClose?: number
  week52High: number
  week52Low: number
  timestamp: Date
  exchange: string
  currency: string
}

export type TradingCalendar = {
  isOpen: boolean
  session: 'PRE_MARKET' | 'OPEN' | 'CLOSED'
  nextOpen: Date | null
  nextClose: Date | null
  tradingDate: string // YYYY-MM-DD
  timezone: string
}

export type HistoricalBar = {
  timestamp: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}
