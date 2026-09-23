import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { prisma } from '../../../lib/prisma'
import { getMarketStatus, getMarketTimezone, getCurrentTradingDate } from '../../../lib/market/sessions'

export const dynamic = 'force-dynamic'

const PROVIDER_NAME = (process.env.MARKET_DATA_PROVIDER || 'yahoo').toLowerCase()

export async function GET(req: NextRequest) {
  try {
    const dateParam = req.nextUrl.searchParams.get('date')
    const tradingDate = dateParam || getCurrentTradingDate()
    const isHistorical = !!dateParam

    // Fetch events for the requested date
    const events = await prisma.marketEvent.findMany({
      where: { tradingDate },
      include: { stock: true },
      orderBy: { timestamp: 'desc' },
    })

    // Stats
    const highs = events.filter((e) => e.eventType === 'HIGH').length
    const lows = events.filter((e) => e.eventType === 'LOW').length
    const volumeSpikes = events.filter((e) => e.eventType === 'VOLUME_SPIKE').length
    const total = highs + lows
    const ratio = lows > 0 ? parseFloat((highs / lows).toFixed(2)) : highs > 0 ? highs : 0

    const latestEvent =
      events.length > 0
        ? {
            symbol: events[0].stock.symbol,
            company: events[0].stock.name,
            type: events[0].eventType,
            price: events[0].price,
            timestamp: events[0].timestamp,
            sector: events[0].stock.sector || 'Unknown',
          }
        : null

    // --- Charts ---

    const timezone = getMarketTimezone()

    // Helper: bucket a timestamp into HH:30 intervals in MARKET time (IST),
    // not server/UTC time — otherwise every event lands in the wrong bucket.
    const getBucket = (d: Date) => {
      const hm = formatInTimeZone(d, timezone, 'HH:mm')
      const mm = hm.slice(3)
      return `${hm.slice(0, 2)}:${mm < '30' ? '00' : '30'}`
    }

    // Seed a bucket for every 30 minutes of the day so ordering is stable and
    // demo-mode events (DEMO_MODE runs 24/7) always find a home.
    const chartMap = new Map<string, { time: string; highs: number; lows: number }>()
    for (let h = 0; h < 24; h++) {
      const hh = h.toString().padStart(2, '0')
      chartMap.set(`${hh}:00`, { time: `${hh}:00`, highs: 0, lows: 0 })
      chartMap.set(`${hh}:30`, { time: `${hh}:30`, highs: 0, lows: 0 })
    }

    events.forEach((e) => {
      if (e.eventType === 'VOLUME_SPIKE') return // exclude from high/low charts
      const b = getBucket(e.timestamp)
      const bucket = chartMap.get(b) || { time: b, highs: 0, lows: 0 }
      if (e.eventType === 'HIGH') bucket.highs += 1
      if (e.eventType === 'LOW') bucket.lows += 1
      chartMap.set(b, bucket)
    })

    const activity = Array.from(chartMap.values()).sort((a, b) =>
      a.time.localeCompare(b.time)
    )

    let cumHighs = 0
    let cumLows = 0
    const cumulative = activity.map((a) => {
      cumHighs += a.highs
      cumLows += a.lows
      return { time: a.time, highs: cumHighs, lows: cumLows }
    })

    // Sector distribution
    const sectorMap = new Map<string, { sector: string; highs: number; lows: number }>()
    events.forEach((e) => {
      if (e.eventType === 'VOLUME_SPIKE') return
      const s = e.stock.sector || 'Unknown'
      const bucket = sectorMap.get(s) || { sector: s, highs: 0, lows: 0 }
      if (e.eventType === 'HIGH') bucket.highs += 1
      if (e.eventType === 'LOW') bucket.lows += 1
      sectorMap.set(s, bucket)
    })
    const sectors = Array.from(sectorMap.values())
      .sort((a, b) => b.highs + b.lows - (a.highs + a.lows))
      .slice(0, 10)

    // Range distribution
    const states = await prisma.dailyStockState.findMany({
      where: { tradingDate },
      select: { lastPrice: true, current52WeekHigh: true, current52WeekLow: true },
    })

    const rangeDist = new Array(10).fill(0)
    states.forEach((s) => {
      if (s.lastPrice != null && s.current52WeekHigh != null && s.current52WeekLow != null) {
        const range = s.current52WeekHigh - s.current52WeekLow
        if (range > 0) {
          let bucket = Math.floor(((s.lastPrice - s.current52WeekLow) / range) * 10)
          bucket = Math.max(0, Math.min(9, bucket))
          rangeDist[bucket] += 1
        }
      }
    })
    const rangeDistribution = rangeDist.map((count, i) => ({
      range: `${i * 10}–${(i + 1) * 10}%`,
      count,
    }))

    // Last updated
    const lastState = await prisma.dailyStockState.findFirst({
      orderBy: { lastQuoteAt: 'desc' },
    })
    const lastUpdated = lastState?.lastQuoteAt?.toISOString() || new Date().toISOString()

    // Available dates (for the date picker) — based on tracked states, so the
    // picker works on days with data even before any event fires.
    const availableDates = await prisma.dailyStockState.findMany({
      select: { tradingDate: true },
      distinct: ['tradingDate'],
      orderBy: { tradingDate: 'desc' },
      take: 30,
    })

    return NextResponse.json({
      market: {
        status: isHistorical ? 'HISTORICAL' : getMarketStatus(),
        timezone,
        lastUpdated,
        tradingDate,
        isHistorical,
        isDemo: process.env.DEMO_MODE === 'true' || PROVIDER_NAME === 'mock',
      },
      stats: { highs, lows, volumeSpikes, total, ratio },
      latestEvent,
      events: events.map((e) => ({
        id: e.id,
        time: e.timestamp,
        symbol: e.stock.symbol,
        company: e.stock.name,
        type: e.eventType,
        price: e.price,
        boundary: e.reference52WeekPrice,
        breakDistance: e.distanceFromBoundary,
        breakPercent: e.percentFromBoundary,
        sector: e.stock.sector || 'Unknown',
        exchange: e.stock.exchange || 'Unknown',
      })),
      charts: { cumulative, activity, sectors, rangeDistribution },
      availableDates: availableDates.map((d) => d.tradingDate),
    })
  } catch (error) {
    console.error('Error in /api/dashboard:', error)
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}
