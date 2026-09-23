import { describe, expect, it } from 'vitest'
import { calculateRangePosition, detectEvents, DetectionState, nextState } from './index'
import { NormalizedQuote } from '../models'

const makeQuote = (overrides: Partial<NormalizedQuote> = {}): NormalizedQuote => ({
  symbol: 'RELIANCE',
  price: 100,
  week52High: 110,
  week52Low: 90,
  timestamp: new Date('2026-09-23T10:00:00+05:30'),
  exchange: 'NSE',
  currency: 'INR',
  ...overrides,
})

const makeState = (overrides: Partial<DetectionState> = {}): DetectionState => ({
  stockId: 'stock-1',
  tradingDate: '2026-09-23',
  previous52WeekHigh: 110,
  previous52WeekLow: 90,
  current52WeekHigh: 110,
  current52WeekLow: 90,
  lastPrice: 105,
  averageVolume: 1_000_000,
  highTriggered: false,
  lowTriggered: false,
  highCurrentlyBroken: false,
  lowCurrentlyBroken: false,
  ...overrides,
})

describe('detectEvents — 52-week boundary crossings', () => {
  it('emits nothing while the price stays inside the range', () => {
    const events = detectEvents(makeQuote({ price: 105 }), makeState({ lastPrice: 104 }), 'CROSSING')
    expect(events).toEqual([])
  })

  it('emits nothing on the very first data point (no previous price)', () => {
    const events = detectEvents(makeQuote({ price: 111 }), makeState({ lastPrice: null }), 'CROSSING')
    expect(events).toEqual([])
  })

  it('detects a HIGH crossing with correct distance and percent', () => {
    const events = detectEvents(makeQuote({ price: 111 }), makeState({ lastPrice: 109 }), 'CROSSING')

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('HIGH')
    expect(events[0].reference52WeekPrice).toBe(110)
    expect(events[0].distanceFromBoundary).toBeCloseTo(1, 10)
    expect(events[0].percentFromBoundary).toBeCloseTo((1 / 110) * 100, 10)
  })

  it('detects a LOW crossing with negative distance', () => {
    const events = detectEvents(makeQuote({ price: 89 }), makeState({ lastPrice: 91 }), 'CROSSING')

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('LOW')
    expect(events[0].reference52WeekPrice).toBe(90)
    expect(events[0].distanceFromBoundary).toBeCloseTo(-1, 10)
  })

  it('does not fire when price merely touches the range without crossing from inside', () => {
    // Price was already above the high on the previous poll — no *new* crossing.
    const events = detectEvents(makeQuote({ price: 112 }), makeState({ lastPrice: 111 }), 'CROSSING')
    expect(events).toEqual([])
  })

  it('emits both HIGH and LOW type events in a single quote only when both cross (impossible in practice)', () => {
    // Guards the engine keeps event types independent: only the low can cross here.
    const events = detectEvents(makeQuote({ price: 89 }), makeState({ lastPrice: 109 }), 'CROSSING')
    expect(events.map((e) => e.eventType)).toEqual(['LOW'])
  })
})

describe('detectEvents — event modes', () => {
  it('CROSSING mode emits on every crossing, even if already triggered', () => {
    const state = makeState({ lastPrice: 109, highTriggered: true })
    const events = detectEvents(makeQuote({ price: 111 }), state, 'CROSSING')
    expect(events.map((e) => e.eventType)).toEqual(['HIGH'])
  })

  it('ONCE_PER_DAY mode suppresses repeat crossings after the first', () => {
    const state = makeState({ lastPrice: 109, highTriggered: true })
    const events = detectEvents(makeQuote({ price: 111 }), state, 'ONCE_PER_DAY')
    expect(events).toEqual([])
  })

  it('ONCE_PER_DAY mode still allows the first crossing of the day', () => {
    const state = makeState({ lastPrice: 109, highTriggered: false })
    const events = detectEvents(makeQuote({ price: 111 }), state, 'ONCE_PER_DAY')
    expect(events.map((e) => e.eventType)).toEqual(['HIGH'])
  })
})

describe('detectEvents — RVOL volume spikes', () => {
  it('emits a VOLUME_SPIKE at exactly 3× average volume', () => {
    const events = detectEvents(
      makeQuote({ price: 105, volume: 3_000_000 }),
      makeState({ lastPrice: 104 }),
      'CROSSING'
    )

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('VOLUME_SPIKE')
    expect(events[0].percentFromBoundary).toBeCloseTo(300, 10)
    expect(events[0].volume).toBe(3_000_000)
  })

  it('stays silent below the 3× threshold', () => {
    const events = detectEvents(
      makeQuote({ price: 105, volume: 2_900_000 }),
      makeState({ lastPrice: 104 }),
      'CROSSING'
    )
    expect(events).toEqual([])
  })

  it('stays silent without an RVOL baseline', () => {
    const events = detectEvents(
      makeQuote({ price: 105, volume: 10_000_000 }),
      makeState({ lastPrice: 104, averageVolume: null }),
      'CROSSING'
    )
    expect(events).toEqual([])
  })

  it('can emit a crossing and a spike together', () => {
    const events = detectEvents(
      makeQuote({ price: 111, volume: 5_000_000 }),
      makeState({ lastPrice: 109 }),
      'CROSSING'
    )
    expect(events.map((e) => e.eventType).sort()).toEqual(['HIGH', 'VOLUME_SPIKE'])
  })
})

describe('nextState — state transitions', () => {
  const highEvent = {
    eventType: 'HIGH' as const,
    price: 111,
    reference52WeekPrice: 110,
    distanceFromBoundary: 1,
    percentFromBoundary: 0.91,
  }

  it('advances lastPrice, raises flags, and ratchets the 52-week high upward', () => {
    const next = nextState(makeQuote({ price: 111 }), makeState({ lastPrice: 109 }), [highEvent])

    expect(next.lastPrice).toBe(111)
    expect(next.highTriggered).toBe(true)
    expect(next.highCurrentlyBroken).toBe(true)
    expect(next.current52WeekHigh).toBe(111)
  })

  it('ratchets the 52-week low downward on a LOW event', () => {
    const lowEvent = {
      eventType: 'LOW' as const,
      price: 89,
      reference52WeekPrice: 90,
      distanceFromBoundary: -1,
      percentFromBoundary: -1.11,
    }
    const next = nextState(makeQuote({ price: 89 }), makeState({ lastPrice: 91 }), [lowEvent])

    expect(next.lowTriggered).toBe(true)
    expect(next.lowCurrentlyBroken).toBe(true)
    expect(next.current52WeekLow).toBe(89)
  })

  it('clears highCurrentlyBroken once price falls back below the previous high', () => {
    const next = nextState(
      makeQuote({ price: 105 }),
      makeState({ lastPrice: 111, highCurrentlyBroken: true, highTriggered: true }),
      []
    )
    expect(next.highCurrentlyBroken).toBe(false)
    expect(next.highTriggered).toBe(true) // the day's trigger flag is sticky
  })

  it('clears lowCurrentlyBroken once price recovers above the previous low', () => {
    const next = nextState(
      makeQuote({ price: 95 }),
      makeState({ lastPrice: 89, lowCurrentlyBroken: true, lowTriggered: true }),
      []
    )
    expect(next.lowCurrentlyBroken).toBe(false)
    expect(next.lowTriggered).toBe(true)
  })

  it('does not mutate the input state', () => {
    const state = makeState({ lastPrice: 109 })
    nextState(makeQuote({ price: 111 }), state, [highEvent])
    expect(state.lastPrice).toBe(109)
    expect(state.current52WeekHigh).toBe(110)
    expect(state.highTriggered).toBe(false)
  })
})

describe('calculateRangePosition', () => {
  it('returns 50 at the midpoint of the range', () => {
    expect(calculateRangePosition(100, 110, 90)).toBe(50)
  })

  it('clamps to 0 below the 52-week low', () => {
    expect(calculateRangePosition(80, 110, 90)).toBe(0)
  })

  it('clamps to 100 above the 52-week high', () => {
    expect(calculateRangePosition(120, 110, 90)).toBe(100)
  })

  it('returns null for a degenerate (zero-width) range to avoid NaN', () => {
    expect(calculateRangePosition(100, 100, 100)).toBeNull()
  })
})
