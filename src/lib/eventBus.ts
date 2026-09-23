/**
 * Lightweight in-process event bus.
 * The ingestion worker publishes events here;
 * the SSE route subscribes and pushes them to browsers.
 */

/** Shape pushed to browsers over SSE — mirrors the /api/dashboard event row. */
export type MarketEventMessage = {
  id: string
  time: Date | string
  symbol: string
  company: string
  type: string
  price: number
  boundary: number
  breakDistance: number
  breakPercent: number
  sector: string
  exchange: string
}

type Listener = (event: MarketEventMessage) => void

export class EventBus {
  private listeners: Set<Listener> = new Set()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  publish(event: MarketEventMessage): void {
    this.listeners.forEach((fn) => {
      try {
        fn(event)
      } catch {
        // swallow – never let one listener crash another
      }
    })
  }
}

// Singleton – shared across all Next.js API routes and the worker
// when running in the same process (dev / `next start`).
const globalForBus = globalThis as unknown as { __eventBus?: EventBus }
export const eventBus: EventBus =
  globalForBus.__eventBus ?? (globalForBus.__eventBus = new EventBus())
