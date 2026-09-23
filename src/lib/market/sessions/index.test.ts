import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentTradingDate, getMarketStatus, getMarketTimezone, isMarketOpen } from './index'

/**
 * All cases are pinned to Asia/Kolkata. September 2026 reference days:
 *   2026-09-23 = Wednesday, 2026-09-26 = Saturday
 */

let savedTimezone: string | undefined
let savedDemoMode: string | undefined

beforeEach(() => {
  savedTimezone = process.env.TIMEZONE
  savedDemoMode = process.env.DEMO_MODE
  process.env.TIMEZONE = 'Asia/Kolkata'
  delete process.env.DEMO_MODE
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  if (savedTimezone === undefined) delete process.env.TIMEZONE
  else process.env.TIMEZONE = savedTimezone
  if (savedDemoMode === undefined) delete process.env.DEMO_MODE
  else process.env.DEMO_MODE = savedDemoMode
})

const at = (iso: string) => vi.setSystemTime(new Date(iso))

describe('getMarketTimezone', () => {
  it('defaults to Asia/Kolkata', () => {
    expect(getMarketTimezone()).toBe('Asia/Kolkata')
  })
})

describe('isMarketOpen — NSE session 09:15–15:30 IST, Mon–Fri', () => {
  it('is OPEN mid-session on a weekday', () => {
    at('2026-09-23T10:00:00+05:30') // Wednesday 10:00 IST
    expect(isMarketOpen()).toBe(true)
    expect(getMarketStatus()).toBe('OPEN')
  })

  it('is OPEN just before the close at 15:29 IST', () => {
    at('2026-09-23T15:29:00+05:30')
    expect(isMarketOpen()).toBe(true)
  })

  it('is CLOSED at exactly 15:30 IST (session end)', () => {
    at('2026-09-23T15:30:00+05:30')
    expect(isMarketOpen()).toBe(false)
    expect(getMarketStatus()).toBe('CLOSED')
  })

  it('is CLOSED one minute before the 09:15 open', () => {
    at('2026-09-23T09:14:00+05:30')
    expect(isMarketOpen()).toBe(false)
  })

  it('is OPEN at 09:15 IST (pre-open ends, regular session begins)', () => {
    at('2026-09-23T09:15:00+05:30')
    expect(isMarketOpen()).toBe(true)
  })

  it('is CLOSED in the evening even on a weekday', () => {
    at('2026-09-23T20:00:00+05:30')
    expect(isMarketOpen()).toBe(false)
  })

  it('is CLOSED on a Saturday even mid-session', () => {
    at('2026-09-26T10:00:00+05:30')
    expect(isMarketOpen()).toBe(false)
  })

  it('evaluates the session in IST, not server-local time', () => {
    // 2026-09-23 23:00 UTC is Thursday 04:30 IST — closed in India.
    at('2026-09-23T23:00:00Z')
    expect(isMarketOpen()).toBe(false)
  })
})

describe('isMarketOpen — DEMO_MODE override', () => {
  it('forces OPEN on a weekend night so the pipeline can be tested anytime', () => {
    process.env.DEMO_MODE = 'true'
    at('2026-09-26T22:00:00+05:30') // Saturday 22:00 IST
    expect(isMarketOpen()).toBe(true)
    expect(getMarketStatus()).toBe('OPEN')
  })
})

describe('getCurrentTradingDate', () => {
  it('returns the IST calendar date, not the UTC date', () => {
    // 2026-09-24 01:00 IST is still 2026-09-23 in UTC.
    at('2026-09-24T01:00:00+05:30')
    expect(getCurrentTradingDate()).toBe('2026-09-24')
  })
})
