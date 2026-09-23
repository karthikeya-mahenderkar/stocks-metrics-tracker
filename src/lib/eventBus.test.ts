import { describe, expect, it } from 'vitest'
import { EventBus, MarketEventMessage } from './eventBus'

const msg = (id: string): MarketEventMessage => ({
  id,
  time: new Date('2026-09-23T10:00:00+05:30'),
  symbol: 'RELIANCE',
  company: 'Reliance Industries',
  type: 'HIGH',
  price: 1480,
  boundary: 1479,
  breakDistance: 1,
  breakPercent: 0.07,
  sector: 'Energy',
  exchange: 'NSE',
})

// The module exports a singleton; tests exercise fresh instances so they
// never interfere with one another.
const makeBus = () => new EventBus()

describe('EventBus', () => {
  it('delivers a published event to every subscriber', () => {
    const bus = makeBus()
    const seenA: MarketEventMessage[] = []
    const seenB: MarketEventMessage[] = []

    bus.subscribe((e) => seenA.push(e))
    bus.subscribe((e) => seenB.push(e))
    bus.publish(msg('1'))

    expect(seenA).toEqual([msg('1')])
    expect(seenB).toEqual([msg('1')])
  })

  it('stops delivering after the returned unsubscribe function is called', () => {
    const bus = makeBus()
    const seen: MarketEventMessage[] = []

    const unsubscribe = bus.subscribe((e) => seen.push(e))
    bus.publish(msg('1'))
    unsubscribe()
    bus.publish(msg('2'))

    expect(seen).toEqual([msg('1')])
  })

  it('isolates listener failures — one throwing listener cannot break the rest', () => {
    const bus = makeBus()
    const seen: MarketEventMessage[] = []

    bus.subscribe(() => {
      throw new Error('boom')
    })
    bus.subscribe((e) => seen.push(e))

    expect(() => bus.publish(msg('1'))).not.toThrow()
    expect(seen).toEqual([msg('1')])
  })

  it('supports unsubscribing the same listener twice safely', () => {
    const bus = makeBus()
    const unsubscribe = bus.subscribe(() => {})
    unsubscribe()
    expect(() => unsubscribe()).not.toThrow()
  })
})
