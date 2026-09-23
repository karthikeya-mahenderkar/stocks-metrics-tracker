'use client'

import { useEffect, useState } from 'react'
import { X, LineChart } from 'lucide-react'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts'
import { cn } from '@/lib/cn'
import { Card, ChartTooltip, EmptyState } from '@/components/ui'

type IntradayData = {
  symbol: string
  name: string
  sector: string | null
  exchange: string
  week52High: number | null
  week52Low: number | null
  lastPrice: number | null
  points: { time: string; price: number; volume: number | null }[]
}

const GREEN = '#34d399'

/** Indian-market currency formatter → ₹1,48,235.40 (en-IN lakh grouping) */
const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn('animate-pulse rounded-lg bg-white/[0.05]', className)} />
)

export default function StockDrawer({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [result, setResult] = useState<{ status: 'ready' | 'error'; data: IntradayData | null } | null>(null)

  // Mounted fresh per symbol (the parent passes `key`), so the initial
  // "loading" state needs no reset inside this effect.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/chart/intraday?symbol=${symbol}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setResult({ status: json ? 'ready' : 'error', data: json })
      })
      .catch(() => {
        if (!cancelled) setResult({ status: 'error', data: null })
      })
    return () => {
      cancelled = true
    }
  }, [symbol])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // null result → still loading; error result → no data (rendered as empty states)
  const loading = result === null
  const data = result?.status === 'ready' ? result.data : null

  const low52 = data?.week52Low ?? null
  const high52 = data?.week52High ?? null
  const lastPrice = data?.lastPrice ?? null
  const rangeSpan = low52 != null && high52 != null ? high52 - low52 : 0
  const positionPct =
    lastPrice != null && low52 != null && rangeSpan > 0
      ? Math.max(0, Math.min(100, ((lastPrice - low52) / rangeSpan) * 100))
      : null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* overlay */}
      <div
        className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      {/* panel */}
      <aside
        role="dialog"
        aria-label={`${symbol} details`}
        className="animate-slide-in-right relative z-10 flex w-full max-w-md flex-col overflow-y-auto border-l border-white/[0.08] bg-[#0c0c0e] shadow-2xl"
      >
        {/* header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/[0.06] bg-[#0c0c0e]/90 px-6 py-4 backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="font-mono text-lg font-bold tracking-tight text-zinc-100">{symbol}</h2>
            </div>
            <p className="mt-0.5 truncate text-sm text-zinc-400">
              {loading ? 'Loading…' : data?.name ?? '—'}
            </p>
            <p className="mt-0.5 text-xs text-zinc-600">
              {data?.sector ?? ''} {data?.sector && data?.exchange ? '·' : ''} {data?.exchange ?? ''}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 px-6 py-6">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-[180px] w-full" />
            </div>
          ) : data ? (
            <>
              {/* price + range position */}
              <Card className="p-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      Last Price
                    </p>
                    <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-zinc-100">
                      {lastPrice != null ? inr(lastPrice) : '—'}
                    </p>
                  </div>
                  {positionPct != null && (
                    <div className="text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        52W Position
                      </p>
                      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-zinc-300">
                        {positionPct.toFixed(0)}%
                      </p>
                    </div>
                  )}
                </div>

                {/* range bar with marker */}
                <div className="mt-5">
                  <div className="mb-1.5 flex justify-between font-mono text-[10px] text-zinc-500">
                    <span>LOW {low52 != null ? inr(low52) : '—'}</span>
                    <span>HIGH {high52 != null ? inr(high52) : '—'}</span>
                  </div>
                  <div className="relative h-2 w-full rounded-full bg-gradient-to-r from-red-500 via-amber-400 to-emerald-400">
                    {positionPct != null && (
                      <span
                        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0c0c0e] bg-white shadow"
                        style={{ left: `${positionPct}%` }}
                      />
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-600">
                    {positionPct != null
                      ? positionPct >= 50
                        ? 'Trading in the upper half of its 52-week range.'
                        : 'Trading in the lower half of its 52-week range.'
                      : '52-week range unavailable.'}
                  </p>
                </div>
              </Card>

              {/* intraday chart */}
              <div>
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Intraday Price
                </p>
                {data.points.length > 0 ? (
                  <div className="h-[190px]">
                    <ResponsiveContainer>
                      <AreaChart data={data.points} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gSpark" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={GREEN} stopOpacity={0.22} />
                            <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis
                          dataKey="time"
                          tickFormatter={(v: string) =>
                            new Date(v).toLocaleTimeString('en-IN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })
                          }
                          tick={{ fill: '#71717a', fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          domain={['auto', 'auto']}
                          tick={{ fill: '#71717a', fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          width={55}
                        />
                        <RechartsTooltip content={<ChartTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="price"
                          name="Price"
                          stroke={GREEN}
                          fill="url(#gSpark)"
                          strokeWidth={1.5}
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState
                    icon={<LineChart className="h-4 w-4" />}
                    title="No intraday points yet"
                    hint="Snapshots accumulate on every poll during market hours — check back shortly."
                    className="h-[190px] rounded-lg border border-dashed border-white/[0.07]"
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState title="Could not load this symbol" hint="It may be outside the tracked universe." />
          )}
        </div>

        {/* footer */}
        <div className="sticky bottom-0 border-t border-white/[0.06] bg-[#0c0c0e]/90 px-6 py-3 backdrop-blur">
          <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
            {data?.exchange ?? 'NSE'} · Times in IST · Press Esc to close
          </p>
        </div>
      </aside>
    </div>
  )
}
