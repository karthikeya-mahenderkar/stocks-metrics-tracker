import 'dotenv/config'
import { prisma } from '../../lib/prisma'
import { MockMarketDataProvider } from '../../lib/market/provider/MockMarketDataProvider'
import { YahooFinanceProvider } from '../../lib/market/provider/YahooFinanceProvider'
import { MarketDataProvider } from '../../lib/market/provider/MarketDataProvider'
import { getCurrentTradingDate, isMarketOpen } from '../../lib/market/sessions'
import { detectEvents, nextState, DetectionState } from '../../lib/market/detection'
import { eventBus } from '../../lib/eventBus'

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_SECONDS || '30', 10) * 1000
const DEMO_MODE = process.env.DEMO_MODE === 'true'
const EVENT_MODE = (process.env.EVENT_MODE as 'CROSSING' | 'ONCE_PER_DAY') || 'CROSSING'
const PROVIDER_NAME = (process.env.MARKET_DATA_PROVIDER || 'yahoo').toLowerCase()

/** Retention: never keep more than this many intraday snapshots per stock. */
const MAX_SNAPSHOTS_PER_STOCK = 200
/** Prune snapshots every N cycles (at 30 s → roughly every 10 minutes). */
const PRUNE_EVERY_N_CYCLES = 20

let provider: MarketDataProvider
let source: string

if (DEMO_MODE || PROVIDER_NAME === 'mock') {
  provider = new MockMarketDataProvider()
  source = 'mock'
} else if (PROVIDER_NAME === 'yahoo') {
  provider = new YahooFinanceProvider()
  source = 'yahoo'
} else {
  console.error(`[worker] Unknown MARKET_DATA_PROVIDER "${PROVIDER_NAME}". Use "mock" or "yahoo".`)
  process.exit(1)
}

let cycleCount = 0
let cycleRunning = false

async function syncUniverse() {
  console.log('[worker] Syncing NSE universe…')
  const stocks = await provider.getStocks()
  const symbols = stocks.map((s) => s.symbol)
  for (const s of stocks) {
    await prisma.stock.upsert({
      where: { symbol: s.symbol },
      update: {
        name: s.name,
        exchange: s.exchange,
        country: s.country ?? 'IN',
        sector: s.sector,
        currency: s.currency ?? 'INR',
        isActive: true,
      },
      create: {
        symbol: s.symbol,
        name: s.name,
        exchange: s.exchange,
        country: s.country ?? 'IN',
        sector: s.sector,
        currency: s.currency ?? 'INR',
        assetType: s.assetType,
        isActive: true,
      },
    })
  }
  // Symbols that dropped out of the universe (delisted/renamed) must stop
  // being polled — otherwise a dead symbol is fetched every cycle forever.
  const retired = await prisma.stock.updateMany({
    where: { symbol: { notIn: symbols }, isActive: true },
    data: { isActive: false },
  })
  console.log(
    `[worker] Synced ${stocks.length} stocks.${retired.count ? ` Retired ${retired.count} stale symbol(s).` : ''}`
  )
}

/** Enforce the snapshot retention cap (called every PRUNE_EVERY_N_CYCLES). */
async function pruneSnapshots() {
  const stocks = await prisma.stock.findMany({ select: { id: true } })
  let deleted = 0
  for (const stock of stocks) {
    const overflow = await prisma.quoteSnapshot.findMany({
      where: { stockId: stock.id },
      orderBy: { timestamp: 'desc' },
      skip: MAX_SNAPSHOTS_PER_STOCK,
      select: { id: true },
    })
    if (overflow.length) {
      const res = await prisma.quoteSnapshot.deleteMany({ where: { id: { in: overflow.map((o) => o.id) } } })
      deleted += res.count
    }
  }
  if (deleted > 0) console.log(`[worker] Pruned ${deleted} old quote snapshots.`)
}

async function runCycle() {
  // A polite Yahoo cycle (delays + backoff) can exceed the poll interval —
  // never let two cycles run at once.
  if (cycleRunning) return
  cycleRunning = true
  try {
    await runCycleInner()
  } finally {
    cycleRunning = false
  }
}

async function runCycleInner() {
  if (!isMarketOpen()) {
    console.log('[worker] Market closed — skipping cycle.')
    return
  }

  const tradingDate = getCurrentTradingDate()
  const activeStocks = await prisma.stock.findMany({ where: { isActive: true } })
  const symbols = activeStocks.map((s) => s.symbol)

  if (symbols.length === 0) return

  console.log(`[worker] Fetching quotes for ${symbols.length} stocks…`)
  const quotes = await provider.getQuotes(symbols)

  for (const quote of quotes) {
    const stock = activeStocks.find((s) => s.symbol === quote.symbol)
    if (!stock) continue

    // Load or create daily state
    let state = await prisma.dailyStockState.findUnique({
      where: { stockId_tradingDate: { stockId: stock.id, tradingDate } },
    })

    if (!state) {
      state = await prisma.dailyStockState.create({
        data: {
          stockId: stock.id,
          tradingDate,
          previous52WeekHigh: quote.week52High,
          previous52WeekLow: quote.week52Low,
          current52WeekHigh: quote.week52High,
          current52WeekLow: quote.week52Low,
          lastPrice: quote.price,
          previousPrice: quote.price,
          averageVolume: quote.averageVolume ?? quote.volume ?? null,
          lastQuoteAt: quote.timestamp,
        },
      })
      continue // first data‐point — no crossing detection yet
    }

    const detectionState: DetectionState = {
      stockId: stock.id,
      tradingDate: state.tradingDate,
      previous52WeekHigh: state.previous52WeekHigh ?? quote.week52High,
      previous52WeekLow: state.previous52WeekLow ?? quote.week52Low,
      current52WeekHigh: state.current52WeekHigh ?? quote.week52High,
      current52WeekLow: state.current52WeekLow ?? quote.week52Low,
      lastPrice: state.lastPrice,
      averageVolume: state.averageVolume,
      highTriggered: state.highTriggered,
      lowTriggered: state.lowTriggered,
      highCurrentlyBroken: state.highCurrentlyBroken,
      lowCurrentlyBroken: state.lowCurrentlyBroken,
    }

    const detectedEvents = detectEvents(quote, detectionState, EVENT_MODE)

    for (const e of detectedEvents) {
      const created = await prisma.marketEvent.create({
        data: {
          stockId: stock.id,
          tradingDate,
          eventType: e.eventType,
          price: e.price,
          reference52WeekPrice: e.reference52WeekPrice,
          distanceFromBoundary: e.distanceFromBoundary,
          percentFromBoundary: e.percentFromBoundary,
          timestamp: quote.timestamp,
          source,
        },
      })

      const ssePayload = {
        id: created.id,
        time: quote.timestamp,
        symbol: quote.symbol,
        company: stock.name,
        type: e.eventType,
        price: e.price,
        boundary: e.reference52WeekPrice,
        breakDistance: e.distanceFromBoundary,
        breakPercent: e.percentFromBoundary,
        sector: stock.sector || 'Unknown',
        exchange: stock.exchange || 'Unknown',
      }

      // Publish to the in-process SSE bus (picked up when worker + web share a
      // process; otherwise the web process bridges these rows over REST/SSE).
      eventBus.publish(ssePayload)

      console.log(`[EVENT] ${quote.symbol} — ${e.eventType} @ ₹${e.price}`)
    }

    const updatedState = nextState(quote, detectionState, detectedEvents)

    await prisma.dailyStockState.update({
      where: { id: state.id },
      data: {
        lastPrice: updatedState.lastPrice,
        previousPrice: state.lastPrice,
        current52WeekHigh: updatedState.current52WeekHigh,
        current52WeekLow: updatedState.current52WeekLow,
        highTriggered: updatedState.highTriggered,
        lowTriggered: updatedState.lowTriggered,
        highCurrentlyBroken: updatedState.highCurrentlyBroken,
        lowCurrentlyBroken: updatedState.lowCurrentlyBroken,
        // Keep the RVOL baseline fresh when the provider supplies one.
        averageVolume: quote.averageVolume ?? state.averageVolume,
        lastQuoteAt: quote.timestamp,
      },
    })

    await prisma.quoteSnapshot.create({
      data: {
        stockId: stock.id,
        price: quote.price,
        volume: quote.volume,
        timestamp: quote.timestamp,
      },
    })
  }

  cycleCount++
  if (cycleCount % PRUNE_EVERY_N_CYCLES === 0) {
    await pruneSnapshots()
  }
}

async function main() {
  await syncUniverse()
  console.log(`[worker] Provider: ${source} · polling every ${POLL_INTERVAL / 1000}s · mode: ${EVENT_MODE}`)

  await runCycle()

  setInterval(() => {
    runCycle().catch((err) => console.error('[worker] cycle error:', err))
  }, POLL_INTERVAL)
}

const shutdown = async (signal: string) => {
  console.log(`\n[worker] ${signal} received — closing Prisma and exiting.`)
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
