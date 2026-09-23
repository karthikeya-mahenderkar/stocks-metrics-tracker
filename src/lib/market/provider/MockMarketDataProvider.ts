import { MarketDataProvider } from './MarketDataProvider'
import { Stock, NormalizedQuote, TradingCalendar, HistoricalBar } from '../models'
import {
  getCurrentTradingDate,
  getMarketTimezone,
  isMarketOpen,
} from '../sessions'

/**
 * Deterministic-ish simulator of the Indian market (NSE) used by DEMO_MODE.
 *
 * Every symbol has a base INR price and a typical daily volume. Each poll does
 * a small random walk, but with a ~10% chance of pushing the price beyond its
 * 52-week high/low so breakout events actually show up in the dashboard, and a
 * ~5% chance of a 3–6× volume spike so RVOL events fire too.
 */
export class MockMarketDataProvider implements MarketDataProvider {
  private basePrices: Record<string, number> = {}
  private week52Highs: Record<string, number> = {}
  private week52Lows: Record<string, number> = {}
  private avgVolumes: Record<string, number> = {}

  private mockStocks: (Stock & { basePrice: number; avgVolume: number })[] = [
    { symbol: 'RELIANCE',  name: 'Reliance Industries',      exchange: 'NSE', country: 'IN', sector: 'Energy',                 currency: 'INR', isActive: true, basePrice: 1480,  avgVolume: 6_500_000 },
    { symbol: 'TCS',       name: 'Tata Consultancy Services', exchange: 'NSE', country: 'IN', sector: 'Information Technology', currency: 'INR', isActive: true, basePrice: 3400,  avgVolume: 3_000_000 },
    { symbol: 'HDFCBANK',  name: 'HDFC Bank',                exchange: 'NSE', country: 'IN', sector: 'Financials',             currency: 'INR', isActive: true, basePrice: 1010,  avgVolume: 9_000_000 },
    { symbol: 'INFY',      name: 'Infosys',                  exchange: 'NSE', country: 'IN', sector: 'Information Technology', currency: 'INR', isActive: true, basePrice: 1650,  avgVolume: 6_000_000 },
    { symbol: 'ICICIBANK', name: 'ICICI Bank',               exchange: 'NSE', country: 'IN', sector: 'Financials',             currency: 'INR', isActive: true, basePrice: 1420,  avgVolume: 7_500_000 },
    { symbol: 'SBIN',      name: 'State Bank of India',      exchange: 'NSE', country: 'IN', sector: 'Financials',             currency: 'INR', isActive: true, basePrice: 830,   avgVolume: 15_000_000 },
    { symbol: 'ITC',       name: 'ITC',                      exchange: 'NSE', country: 'IN', sector: 'Consumer Staples',       currency: 'INR', isActive: true, basePrice: 415,   avgVolume: 12_000_000 },
    { symbol: 'BHARTIARTL',name: 'Bharti Airtel',            exchange: 'NSE', country: 'IN', sector: 'Communication Services', currency: 'INR', isActive: true, basePrice: 1960,  avgVolume: 4_500_000 },
    { symbol: 'LT',        name: 'Larsen & Toubro',          exchange: 'NSE', country: 'IN', sector: 'Industrials',            currency: 'INR', isActive: true, basePrice: 3820,  avgVolume: 2_800_000 },
    { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank',      exchange: 'NSE', country: 'IN', sector: 'Financials',             currency: 'INR', isActive: true, basePrice: 1060,  avgVolume: 5_000_000 },
    { symbol: 'MARUTI',    name: 'Maruti Suzuki India',      exchange: 'NSE', country: 'IN', sector: 'Consumer Discretionary', currency: 'INR', isActive: true, basePrice: 15200, avgVolume: 600_000 },
    { symbol: 'TATAMOTORS',name: 'Tata Motors',              exchange: 'NSE', country: 'IN', sector: 'Consumer Discretionary', currency: 'INR', isActive: true, basePrice: 720,   avgVolume: 11_000_000 },
  ]

  constructor() {
    this.mockStocks.forEach((s) => {
      this.basePrices[s.symbol] = s.basePrice
      this.avgVolumes[s.symbol] = s.avgVolume
      this.week52Highs[s.symbol] = s.basePrice * 1.05 // 5% above base
      this.week52Lows[s.symbol] = s.basePrice * 0.95   // 5% below base
    })
  }

  async getStocks(): Promise<Stock[]> {
    return this.mockStocks.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      exchange: s.exchange,
      country: s.country,
      sector: s.sector,
      currency: s.currency,
      assetType: s.assetType,
      isActive: s.isActive,
    }))
  }

  async getQuote(symbol: string): Promise<NormalizedQuote | null> {
    const quotes = await this.getQuotes([symbol])
    return quotes[0] || null
  }

  async getQuotes(symbols: string[]): Promise<NormalizedQuote[]> {
    return symbols
      .filter((sym) => this.basePrices[sym] !== undefined)
      .map((sym) => {
        const base = this.basePrices[sym]
        const high = this.week52Highs[sym]
        const low = this.week52Lows[sym]
        const avgVolume = this.avgVolumes[sym]

        // Random walk around the base price…
        const roll = Math.random()
        let price = base + (Math.random() - 0.5) * base * 0.02 // ±1%

        // …with a 10% chance of breaking a 52-week boundary (drives HIGH/LOW events).
        if (roll > 0.9) price = high + Math.random() * base * 0.01
        else if (roll < 0.1) price = low - Math.random() * base * 0.01

        // Volume sits around the 20-day average, occasionally spiking past the
        // 3× RVOL threshold (drives VOLUME_SPIKE events).
        const volume =
          Math.random() < 0.05
            ? Math.round(avgVolume * (3 + Math.random() * 3))
            : Math.round(avgVolume * (0.4 + Math.random() * 1.1))

        const stock = this.mockStocks.find((s) => s.symbol === sym)

        return {
          symbol: sym,
          price: Number(price.toFixed(2)),
          volume,
          averageVolume: avgVolume,
          previousClose: base,
          week52High: high,
          week52Low: low,
          timestamp: new Date(),
          exchange: stock?.exchange || 'NSE',
          currency: 'INR',
        }
      })
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

  async getHistoricalData(): Promise<HistoricalBar[]> {
    return [] // the simulator has no history — intraday snapshots fill the chart
  }
}
