import { eventBus } from '../../../lib/eventBus'
import { prisma } from '../../../lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * SSE endpoint.
 *
 * The ingestion worker and this Next.js server normally run as *separate*
 * processes, so the in-process eventBus alone would never deliver worker
 * events to browsers. A single background bridge (started lazily, stored on
 * globalThis so dev-reloads don't stack timers) polls newly written
 * MarketEvent rows and republishes them on the bus; every connection then
 * just subscribes — one query total, regardless of client count.
 */
const BRIDGE_INTERVAL_MS = 2_000

type Bridge = { timer: ReturnType<typeof setInterval>; cursor: Date }
const globalForBridge = globalThis as unknown as { __sseBridge?: Bridge }

async function pollNewEvents(cursor: Date): Promise<Date> {
  const rows = await prisma.marketEvent.findMany({
    where: { createdAt: { gt: cursor } },
    orderBy: { createdAt: 'asc' },
    take: 200,
    include: { stock: true },
  })

  let nextCursor = cursor
  for (const e of rows) {
    if (e.createdAt > nextCursor) nextCursor = e.createdAt
    eventBus.publish({
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
    })
  }
  return nextCursor
}

function ensureBridge() {
  if (globalForBridge.__sseBridge) return

  const bridge: Bridge = { timer: setInterval(() => {}, 0), cursor: new Date() }
  clearInterval(bridge.timer)

  const tick = async () => {
    try {
      bridge.cursor = await pollNewEvents(bridge.cursor)
    } catch (err) {
      console.error('[sse-bridge] poll failed:', err)
    }
  }

  void tick()
  bridge.timer = setInterval(() => void tick(), BRIDGE_INTERVAL_MS)
  globalForBridge.__sseBridge = bridge
}

export async function GET() {
  ensureBridge()

  const encoder = new TextEncoder()
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      // Send a heartbeat every 15 s so the connection stays alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          cleanup?.()
        }
      }, 15_000)

      const unsubscribe = eventBus.subscribe((event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          cleanup?.()
        }
      })

      cleanup = () => {
        clearInterval(heartbeat)
        unsubscribe()
        cleanup = null
      }
    },
    cancel() {
      // Browser closed the connection — stop the heartbeat and unsubscribe.
      cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
