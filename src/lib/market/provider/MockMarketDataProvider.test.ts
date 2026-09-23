import { describe, expect, it } from 'vitest'
import { MockMarketDataProvider } from './MockMarketDataProvider'

const provider = new MockMarketDataProvider()

describe('MockMarketDataProvider — Indian market simulator', () => {
  it('serves an NSE universe denominated in INR', async () => {
    const stocks = await provider.getStocks()

    expect(stocks.length).toBeGreaterThanOrEqual(10)
    expect(stocks.map((s) => s.symbol)).toContain('RELIANCE')

    for (const stock of stocks) {
      expect(stock.exchange).toBe('NSE')
      expect(stock.country).toBe('IN')
      expect(stock.currency).toBe('INR')
      expect(stock.sector).toBeTruthy()
      expect(stock.isActive).toBe(true)
    }
  })

  it('never leaks simulation internals through getStocks()', async () => {
    const [stock] = await provider.getStocks()
    expect(stock).not.toHaveProperty('basePrice')
    expect(stock).not.toHaveProperty('avgVolume')
  })

  it('produces quotes with a valid 52-week range and RVOL baseline', async () => {
    const quotes = await provider.getQuotes(['RELIANCE', 'TCS', 'NOT_A_SYMBOL'])

    // Unknown symbols are dropped rather than guessed at.
    expect(quotes.map((q) => q.symbol)).toEqual(['RELIANCE', 'TCS'])

    for (const quote of quotes) {
      expect(quote.currency).toBe('INR')
      expect(quote.exchange).toBe('NSE')
      expect(quote.price).toBeGreaterThan(0)
      expect(quote.week52High).toBeGreaterThan(quote.week52Low)
      expect(quote.averageVolume).toBeGreaterThan(0)
      expect(quote.volume).toBeGreaterThan(0)
      expect(quote.timestamp).toBeInstanceOf(Date)
    }
  })

  it('keeps prices inside a plausible band most of the time', async () => {
    const quotes = await provider.getQuotes(['ITC', 'SBIN', 'MARUTI'])
    for (const quote of quotes) {
      // ±1% walk, or a deliberate breakout up to ~6% beyond a boundary.
      expect(quote.price).toBeGreaterThan(quote.week52Low * 0.9)
      expect(quote.price).toBeLessThan(quote.week52High * 1.1)
    }
  })

  it('reports the calendar in the configured market timezone', async () => {
    const calendar = await provider.getTradingCalendar()
    expect(calendar.timezone).toBe('Asia/Kolkata')
    expect(calendar.tradingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
