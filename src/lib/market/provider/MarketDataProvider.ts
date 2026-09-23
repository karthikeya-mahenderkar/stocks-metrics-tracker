import { Stock, NormalizedQuote, TradingCalendar, HistoricalBar } from '../models'

export interface MarketDataProvider {
  getStocks(): Promise<Stock[]>
  getQuote(symbol: string): Promise<NormalizedQuote | null>
  getQuotes(symbols: string[]): Promise<NormalizedQuote[]>
  getTradingCalendar(): Promise<TradingCalendar>
  getHistoricalData(symbol: string, startDate: string, endDate: string): Promise<HistoricalBar[]>
}
