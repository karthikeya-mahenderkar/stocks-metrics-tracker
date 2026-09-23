import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')
  if (!symbol) {
    return NextResponse.json({ error: 'symbol parameter required' }, { status: 400 })
  }

  const stock = await prisma.stock.findUnique({ where: { symbol } })
  if (!stock) {
    return NextResponse.json({ error: 'Stock not found' }, { status: 404 })
  }

  // Fetch the most recent 100 snapshots for the stock
  const snapshots = await prisma.quoteSnapshot.findMany({
    where: { stockId: stock.id },
    orderBy: { timestamp: 'desc' },
    take: 100,
  })

  // Reverse so oldest is first (for charting)
  const points = snapshots.reverse().map((s) => ({
    time: s.timestamp.toISOString(),
    price: s.price,
    volume: s.volume,
  }))

  // Also return the current daily state for context
  const state = await prisma.dailyStockState.findFirst({
    where: { stockId: stock.id },
    orderBy: { tradingDate: 'desc' },
  })

  return NextResponse.json({
    symbol: stock.symbol,
    name: stock.name,
    sector: stock.sector,
    exchange: stock.exchange,
    week52High: state?.current52WeekHigh,
    week52Low: state?.current52WeekLow,
    lastPrice: state?.lastPrice,
    points,
  })
}
