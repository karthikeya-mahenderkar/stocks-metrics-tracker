import { NormalizedQuote } from '../models'

export type DetectionState = {
  stockId: string
  tradingDate: string
  previous52WeekHigh: number
  previous52WeekLow: number
  current52WeekHigh: number
  current52WeekLow: number
  lastPrice: number | null
  averageVolume: number | null
  highTriggered: boolean
  lowTriggered: boolean
  highCurrentlyBroken: boolean
  lowCurrentlyBroken: boolean
}

export type DetectedEvent = {
  eventType: 'HIGH' | 'LOW' | 'VOLUME_SPIKE'
  price: number
  reference52WeekPrice: number
  distanceFromBoundary: number
  percentFromBoundary: number
  volume?: number
}

const RVOL_THRESHOLD = 3.0 // 300% of average volume

/**
 * Pure function to detect 52-week boundary crossings and volume spikes.
 */
export function detectEvents(
  quote: NormalizedQuote,
  state: DetectionState,
  mode: 'CROSSING' | 'ONCE_PER_DAY'
): DetectedEvent[] {
  const events: DetectedEvent[] = []

  if (!state.lastPrice) return events

  // --- HIGH crossing ---
  const brokeHigh =
    state.lastPrice < state.current52WeekHigh &&
    quote.price >= state.current52WeekHigh

  if (brokeHigh) {
    if (mode === 'CROSSING' || (mode === 'ONCE_PER_DAY' && !state.highTriggered)) {
      events.push({
        eventType: 'HIGH',
        price: quote.price,
        reference52WeekPrice: state.current52WeekHigh,
        distanceFromBoundary: quote.price - state.current52WeekHigh,
        percentFromBoundary:
          ((quote.price - state.current52WeekHigh) / state.current52WeekHigh) * 100,
      })
    }
  }

  // --- LOW crossing ---
  const brokeLow =
    state.lastPrice > state.current52WeekLow &&
    quote.price <= state.current52WeekLow

  if (brokeLow) {
    if (mode === 'CROSSING' || (mode === 'ONCE_PER_DAY' && !state.lowTriggered)) {
      events.push({
        eventType: 'LOW',
        price: quote.price,
        reference52WeekPrice: state.current52WeekLow,
        distanceFromBoundary: quote.price - state.current52WeekLow,
        percentFromBoundary:
          ((quote.price - state.current52WeekLow) / state.current52WeekLow) * 100,
      })
    }
  }

  // --- VOLUME SPIKE ---
  if (
    quote.volume &&
    state.averageVolume &&
    state.averageVolume > 0 &&
    quote.volume >= state.averageVolume * RVOL_THRESHOLD
  ) {
    events.push({
      eventType: 'VOLUME_SPIKE',
      price: quote.price,
      reference52WeekPrice: state.current52WeekHigh, // contextual reference
      distanceFromBoundary: 0,
      percentFromBoundary: (quote.volume / state.averageVolume) * 100,
      volume: quote.volume,
    })
  }

  return events
}

/**
 * Pure function to calculate updated state after processing a quote.
 */
export function nextState(
  quote: NormalizedQuote,
  state: DetectionState,
  events: DetectedEvent[]
): DetectionState {
  const newState = { ...state }
  newState.lastPrice = quote.price

  events.forEach((e) => {
    if (e.eventType === 'HIGH') {
      newState.highTriggered = true
      newState.highCurrentlyBroken = true
      newState.current52WeekHigh = Math.max(
        state.current52WeekHigh,
        quote.price
      )
    }
    if (e.eventType === 'LOW') {
      newState.lowTriggered = true
      newState.lowCurrentlyBroken = true
      newState.current52WeekLow = Math.min(
        state.current52WeekLow,
        quote.price
      )
    }
  })

  // Reset broken status if price returns to normal range
  if (newState.highCurrentlyBroken && quote.price < state.previous52WeekHigh) {
    newState.highCurrentlyBroken = false
  }
  if (newState.lowCurrentlyBroken && quote.price > state.previous52WeekLow) {
    newState.lowCurrentlyBroken = false
  }

  return newState
}

/**
 * Calculate where a stock sits within its 52-week range (0–100 %).
 * Returns null when the range is zero to avoid NaN / Infinity.
 */
export function calculateRangePosition(
  price: number,
  week52High: number,
  week52Low: number
): number | null {
  const range = week52High - week52Low
  if (range <= 0) return null
  const position = ((price - week52Low) / range) * 100
  return Math.max(0, Math.min(100, position))
}
