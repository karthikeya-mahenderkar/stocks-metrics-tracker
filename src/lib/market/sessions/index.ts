import { formatInTimeZone } from 'date-fns-tz'

/**
 * Indian market (NSE) session helpers.
 *
 * Regular session: 09:15 – 15:30 IST (Asia/Kolkata), Monday–Friday.
 * All checks are done in the market timezone, never in server-local time.
 */

export function getMarketTimezone(): string {
  return process.env.TIMEZONE || 'Asia/Kolkata'
}

export function getCurrentTradingDate(): string {
  return formatInTimeZone(new Date(), getMarketTimezone(), 'yyyy-MM-dd')
}

export function isMarketOpen(): boolean {
  // Demo mode always reports "open" so the pipeline can be exercised on any
  // day / at any hour, independent of the real NSE session.
  if (process.env.DEMO_MODE === 'true') return true

  const tz = getMarketTimezone()
  const now = new Date()

  const isoDay = Number(formatInTimeZone(now, tz, 'i')) // 1 = Mon … 7 = Sun
  if (isoDay === 6 || isoDay === 7) return false

  const timeNum = Number(formatInTimeZone(now, tz, 'HHmm'))
  return timeNum >= 915 && timeNum < 1530
}

export function getMarketStatus(): 'OPEN' | 'CLOSED' {
  return isMarketOpen() ? 'OPEN' : 'CLOSED'
}
