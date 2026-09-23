'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  AlertTriangle,
  Calendar,
  Percent,
  RotateCcw,
  Search,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  AreaChart,
  Area,
} from 'recharts'
import { cn } from '@/lib/cn'
import StockDrawer from '@/components/StockDrawer'
import {
  Badge,
  Card,
  ChartCard,
  ChartTooltip,
  EmptyState,
  SectionHeading,
  Segmented,
  StatCard,
} from '@/components/ui'

/* ─── types ─── */
type DashboardEvent = {
  id: string
  time: string
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
type DashboardData = {
  market: { status: string; timezone: string; lastUpdated: string; tradingDate: string; isHistorical: boolean; isDemo: boolean }
  stats: { highs: number; lows: number; volumeSpikes: number; total: number; ratio: number }
  latestEvent: { symbol: string; company: string; type: string; price: number; timestamp: string; sector: string } | null
  events: DashboardEvent[]
  charts: {
    cumulative: { time: string; highs: number; lows: number }[]
    activity: { time: string; highs: number; lows: number }[]
    sectors: { sector: string; highs: number; lows: number }[]
    rangeDistribution: { range: string; count: number }[]
  }
  availableDates: string[]
}

const GREEN = '#34d399'
const RED = '#f87171'

/** Indian-market currency formatter → ₹1,48,235.40 (en-IN lakh grouping) */
const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const clockTime = (t: string) =>
  new Date(t).toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' })

/** Ticking IST clock — isolated so only this small node re-renders each second. */
const Clock = () => {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span
      suppressHydrationWarning
      className="hidden font-mono text-xs tabular-nums text-zinc-500 md:inline"
    >
      {clockTime(now.toISOString())} IST
    </span>
  )
}

/* ─── loading skeleton ─── */
const SkelCard = ({ className }: { className?: string }) => (
  <div className={cn('animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.03] p-5', className)}>
    <div className="h-3 w-24 rounded bg-white/[0.05]" />
    <div className="mt-4 h-7 w-14 rounded bg-white/[0.05]" />
  </div>
)

const LoadingScreen = () => (
  <div className="min-h-screen">
    <header className="h-16 border-b border-white/[0.06] bg-[#09090b]/80" />
    <main className="mx-auto max-w-[1500px] space-y-6 px-5 py-6 sm:px-8">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkelCard key={i} className={i === 5 ? 'col-span-2 md:col-span-1' : ''} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SkelCard className="h-[340px] lg:col-span-2" />
        <SkelCard className="h-[340px]" />
      </div>
      <SkelCard className="h-64" />
    </main>
  </div>
)

/* ─── error state ─── */
const ErrorScreen = ({ onRetry }: { onRetry: () => void }) => (
  <div className="flex min-h-screen items-center justify-center px-6">
    <Card className="w-full max-w-sm p-8 text-center">
      <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/20">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-zinc-100">Dashboard unavailable</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        The API did not respond. Make sure the Next.js server is running, then try again.
      </p>
      <button
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-white/[0.08] px-4 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/[0.14]"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Retry
      </button>
    </Card>
  </div>
)

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<string>('ALL')
  const [selectedDate, setSelectedDate] = useState('')
  const [drawerSymbol, setDrawerSymbol] = useState<string | null>(null)

  /* ─── fetch dashboard (initial + polling fallback) ─── */
  const fetchDashboard = useCallback(async () => {
    try {
      const url = selectedDate ? `/api/dashboard?date=${selectedDate}` : '/api/dashboard'
      const res = await fetch(url)
      if (!res.ok) throw new Error()
      const json: DashboardData = await res.json()
      setData(json)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  const retry = useCallback(() => {
    setLoading(true)
    setError(false)
    void fetchDashboard()
  }, [fetchDashboard])

  /* ─── SSE live stream (only when viewing today) ─── */
  useEffect(() => {
    if (selectedDate) return // history mode → no SSE

    const es = new EventSource('/api/stream')
    es.onmessage = (msg) => {
      try {
        const event: DashboardEvent = JSON.parse(msg.data)
        setData((prev) => {
          if (!prev) return prev
          if (prev.events.some((e) => e.id === event.id)) return prev
          const newEvents = [event, ...prev.events]
          const highs = newEvents.filter((e) => e.type === 'HIGH').length
          const lows = newEvents.filter((e) => e.type === 'LOW').length
          const spikes = newEvents.filter((e) => e.type === 'VOLUME_SPIKE').length
          return {
            ...prev,
            events: newEvents,
            stats: {
              ...prev.stats,
              highs,
              lows,
              volumeSpikes: spikes,
              total: highs + lows,
              ratio: lows > 0 ? parseFloat((highs / lows).toFixed(2)) : highs,
            },
            latestEvent: {
              symbol: event.symbol,
              company: event.company,
              type: event.type,
              price: event.price,
              timestamp: event.time,
              sector: event.sector,
            },
          }
        })
      } catch {
        /* ignore malformed */
      }
    }

    return () => es.close()
  }, [selectedDate])

  /* ─── initial fetch + polling every 30 s ─── */
  useEffect(() => {
    // First load is deferred one tick and the poller is registered here, so the
    // effect body only *schedules* work instead of setting state synchronously
    // (react-hooks/set-state-in-effect).
    const kickoff = setTimeout(fetchDashboard, 0)
    const id = setInterval(fetchDashboard, 30_000)
    return () => {
      clearTimeout(kickoff)
      clearInterval(id)
    }
  }, [fetchDashboard])

  if (loading) return <LoadingScreen />
  if (error || !data) return <ErrorScreen onRetry={retry} />

  const filteredEvents = data.events.filter((e) => {
    if (filterType !== 'ALL' && e.type !== filterType) return false
    if (search) {
      const q = search.toLowerCase()
      return e.symbol.toLowerCase().includes(q) || e.company.toLowerCase().includes(q)
    }
    return true
  })

  const isLive = data.market.status === 'OPEN' && !data.market.isHistorical
  const latest = data.latestEvent
  const { highs, lows, volumeSpikes, total, ratio } = data.stats
  const ratioDisplay = lows > 0 ? `${ratio}×` : highs > 0 ? '∞' : '—'
  const ratioSub = lows > 0 ? 'highs per low' : highs > 0 ? 'no lows yet' : 'no extremes'
  const rangeDist = data.charts.rangeDistribution
  const rangeColors = rangeDist.map((_, i) =>
    `hsl(${Math.round((i / Math.max(1, rangeDist.length - 1)) * 140)}, 72%, 56%)`
  )

  const feedEmpty =
    data.events.length === 0
      ? {
          title: 'No events yet',
          hint: isLive
            ? 'Watching the NSE universe — the feed lights up the moment a stock crosses its 52-week high or low.'
            : 'The market is closed. Events resume in the next session.',
        }
      : { title: 'No events match your filters', hint: 'Try a different search or filter.' }

  return (
    <div className="min-h-screen">
      {/* ─── ambient background ─── */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.022)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.022)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_0%,transparent_75%)]" />
        <div className="absolute -top-32 right-[8%] h-96 w-96 rounded-full bg-emerald-500/[0.06] blur-[130px]" />
        <div className="absolute top-1/3 -left-32 h-96 w-96 rounded-full bg-sky-500/[0.05] blur-[130px]" />
      </div>

      {/* ─── HEADER ─── */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#09090b]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-4 px-5 sm:px-8">
          {/* brand */}
          <div className="flex items-center gap-3">
            <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            </span>
            <div className="leading-tight">
              <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">
                Market Extremes
              </h1>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                NSE · 52-Week Monitor
              </p>
            </div>
          </div>

          {/* controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* date picker */}
            <label className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 transition-colors focus-within:border-white/20">
              <Calendar className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <input
                type="date"
                list="available-dates"
                max={data.market.tradingDate}
                className="w-[104px] bg-transparent text-xs text-zinc-300 outline-none focus-visible:outline-none [color-scheme:dark]"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                aria-label="View historical date"
              />
              {selectedDate && (
                <button
                  onClick={() => setSelectedDate('')}
                  aria-label="Clear date"
                  className="text-zinc-500 transition-colors hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </label>
            <datalist id="available-dates">
              {data.availableDates.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>

            {/* market status pill */}
            <div
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide',
                isLive
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                  : data.market.isHistorical
                    ? 'border-sky-500/20 bg-sky-500/10 text-sky-400'
                    : 'border-white/[0.08] bg-white/[0.04] text-zinc-400'
              )}
            >
              {isLive ? (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
              {data.market.isHistorical
                ? `History · ${data.market.tradingDate}`
                : isLive
                  ? 'Market Open'
                  : 'Market Closed'}
            </div>

            <Clock />
          </div>
        </div>

        {/* Demo banner — only when the pipeline is actually running on mock data */}
        {data.market.isDemo && (
          <div className="border-t border-amber-500/10 bg-amber-500/[0.04] px-6 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-500/90">
            Demo data — simulated NSE events
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1500px] space-y-4 px-5 py-6 sm:px-8">
        {/* ─── KPI ROW ─── */}
        <section className="animate-fade-up grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="52W Highs"
            value={highs}
            sub="breakouts"
            tone="up"
            icon={<ArrowUpRight className="h-3.5 w-3.5" />}
          />
          <StatCard
            label="52W Lows"
            value={lows}
            sub="breakdowns"
            tone="down"
            icon={<ArrowDownRight className="h-3.5 w-3.5" />}
          />
          <StatCard
            label="Volume Spikes"
            value={volumeSpikes}
            sub="≥ 3× avg vol"
            tone="spike"
            icon={<Zap className="h-3.5 w-3.5" />}
          />
          <StatCard
            label="Total Extremes"
            value={total}
            sub="highs + lows"
            icon={<Activity className="h-3.5 w-3.5" />}
          />
          <StatCard
            label="High / Low"
            value={ratioDisplay}
            sub={ratioSub}
            icon={<Percent className="h-3.5 w-3.5" />}
          />

          {/* latest event */}
          <Card
            className={cn(
              'col-span-2 p-4 transition-colors md:col-span-3 xl:col-span-1',
              data.latestEvent && 'hover:border-white/[0.12]'
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Latest Event
            </p>
            {latest ? (
              <button
                onClick={() => setDrawerSymbol(latest.symbol)}
                className="group mt-2 block w-full text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xl font-bold text-zinc-100 transition-colors group-hover:text-white">
                    {latest.symbol}
                  </span>
                  <Badge type={latest.type} />
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-sm font-medium tabular-nums text-zinc-300">
                    {inr(latest.price)}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-600">
                    {clockTime(latest.timestamp)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-zinc-600">{latest.company}</p>
              </button>
            ) : (
              <div className="mt-2">
                <p className="text-sm font-medium text-zinc-400">No crossings yet</p>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">
                  Events appear the moment a tracked stock breaks its 52-week range.
                </p>
              </div>
            )}
          </Card>
        </section>

        {/* ─── CHARTS ROW 1 ─── */}
        <section className="animate-fade-up grid gap-4 lg:grid-cols-3" style={{ animationDelay: '60ms' }}>
          <ChartCard
            className="lg:col-span-2"
            title="Cumulative Extremes"
            subtitle="Running total of 52-week highs & lows for the session"
            height={280}
            legend={[
              { color: GREEN, label: 'Highs' },
              { color: RED, label: 'Lows' },
            ]}
            empty={{ title: 'No cumulative data yet', hint: 'Charted as soon as the first crossing lands.' }}
          >
            <ResponsiveContainer>
              <AreaChart data={data.charts.cumulative} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gHigh" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={GREEN} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gLow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={RED} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={RED} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="time" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
                <RechartsTooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="highs" name="Highs" stroke={GREEN} fill="url(#gHigh)" strokeWidth={2} />
                <Area type="monotone" dataKey="lows" name="Lows" stroke={RED} fill="url(#gLow)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Activity by Time"
            subtitle="Events per 30-minute window (IST)"
            height={280}
            legend={[
              { color: GREEN, label: 'Highs' },
              { color: RED, label: 'Lows' },
            ]}
            empty={{ title: 'No activity yet', hint: 'Buckets fill up through the trading session.' }}
          >
            <ResponsiveContainer>
              <BarChart data={data.charts.activity} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="time" tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                <RechartsTooltip content={<ChartTooltip />} />
                <Bar dataKey="highs" name="Highs" fill={GREEN} radius={[3, 3, 0, 0]} />
                <Bar dataKey="lows" name="Lows" fill={RED} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </section>

        {/* ─── CHARTS ROW 2 ─── */}
        <section className="animate-fade-up grid gap-4 lg:grid-cols-2" style={{ animationDelay: '120ms' }}>
          <ChartCard
            title="Sector Distribution"
            subtitle="Highs & lows grouped by sector"
            height={250}
            legend={[
              { color: GREEN, label: 'Highs' },
              { color: RED, label: 'Lows' },
            ]}
            empty={{ title: 'No sector data yet' }}
          >
            {data.charts.sectors.length > 0 ? (
              <ResponsiveContainer>
                <BarChart data={data.charts.sectors} layout="vertical" margin={{ top: 5, right: 20, left: 5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis type="number" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="sector" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <Bar dataKey="highs" name="Highs" fill={GREEN} stackId="a" />
                  <Bar dataKey="lows" name="Lows" fill={RED} stackId="a" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState className="h-full" title="No sector data yet" />
            )}
          </ChartCard>

          <ChartCard
            title="52-Week Range Position"
            subtitle="Where each stock sits: 0% = at its 52-week low · 100% = at its high"
            height={250}
            empty={{ title: 'No range data yet', hint: 'Tracked once daily states are written for the session.' }}
          >
            <ResponsiveContainer>
              <BarChart data={rangeDist} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="range" tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                <RechartsTooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Stocks" radius={[4, 4, 0, 0]}>
                  {rangeDist.map((bucket, i) => (
                    <Cell key={bucket.range} fill={rangeColors[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </section>

        {/* ─── EVENT FEED ─── */}
        <section className="animate-fade-up" style={{ animationDelay: '180ms' }}>
          <Card>
            <div className="flex flex-col gap-3 border-b border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex items-center gap-3">
                <SectionHeading title="Event Feed" />
                <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-zinc-400 ring-1 ring-inset ring-white/[0.06]">
                  {filteredEvents.length}
                </span>
                {!selectedDate && isLive && (
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    </span>
                    Live
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                  <input
                    placeholder="Search symbol or company…"
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] py-2 pl-8 pr-3 text-xs text-zinc-300 outline-none transition-colors placeholder:text-zinc-600 focus:border-white/20 focus-visible:outline-none sm:w-56"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search events"
                  />
                </div>
                <Segmented
                  value={filterType}
                  onChange={setFilterType}
                  options={[
                    { value: 'ALL', label: 'All' },
                    { value: 'HIGH', label: <span className="flex items-center gap-1"><ArrowUpRight className="h-3 w-3" />Highs</span> },
                    { value: 'LOW', label: <span className="flex items-center gap-1"><ArrowDownRight className="h-3 w-3" />Lows</span> },
                    { value: 'VOLUME_SPIKE', label: <span className="flex items-center gap-1"><Zap className="h-3 w-3" />Spikes</span> },
                  ]}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/[0.05] text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                    <th className="px-4 py-3 font-semibold sm:px-5">Time</th>
                    <th className="px-4 py-3 font-semibold sm:px-5">Symbol</th>
                    <th className="hidden px-4 py-3 font-semibold sm:table-cell sm:px-5">Company</th>
                    <th className="px-4 py-3 font-semibold sm:px-5">Type</th>
                    <th className="px-4 py-3 text-right font-semibold sm:px-5">Price</th>
                    <th className="px-4 py-3 text-right font-semibold sm:px-5">Signal</th>
                    <th className="hidden px-4 py-3 font-semibold md:table-cell sm:px-5">Sector</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {filteredEvents.length > 0 ? (
                    filteredEvents.map((e) => (
                      <tr
                        key={e.id}
                        onClick={() => setDrawerSymbol(e.symbol)}
                        className="cursor-pointer transition-colors hover:bg-white/[0.025]"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-zinc-500 sm:px-5">
                          {clockTime(e.time)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-zinc-100 sm:px-5">
                          {e.symbol}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-zinc-400 sm:table-cell sm:px-5">
                          {e.company}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 sm:px-5">
                          <Badge type={e.type} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-medium tabular-nums text-zinc-200 sm:px-5">
                          {inr(e.price)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs tabular-nums sm:px-5">
                          {e.type === 'VOLUME_SPIKE' ? (
                            <span className="font-semibold text-amber-400">
                              {(e.breakPercent / 100).toFixed(2)}× avg vol
                            </span>
                          ) : (
                            <span className={e.type === 'HIGH' ? 'text-emerald-400' : 'text-red-400'}>
                              {e.type === 'HIGH' ? '+' : '−'}
                              {inr(Math.abs(e.breakDistance))}{' '}
                              <span className="opacity-60">({e.breakPercent.toFixed(2)}%)</span>
                            </span>
                          )}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-zinc-500 md:table-cell sm:px-5">
                          {e.sector}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-6 py-16">
                        <EmptyState title={feedEmpty.title} hint={feedEmpty.hint} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="mx-auto max-w-[1500px] px-5 pb-8 pt-2 sm:px-8">
        <p className="text-center text-[11px] text-zinc-700 sm:text-left">
          Market Extremes · NSE data via Yahoo Finance · Sessions 09:15–15:30 IST ·{' '}
          {new Date().getFullYear()}
        </p>
      </footer>

      {/* ─── STOCK DETAIL DRAWER ─── */}
      {drawerSymbol && (
        <StockDrawer key={drawerSymbol} symbol={drawerSymbol} onClose={() => setDrawerSymbol(null)} />
      )}
    </div>
  )
}
