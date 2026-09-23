import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Zap, Inbox } from 'lucide-react'
import { cn } from '@/lib/cn'

/* ─── shared surface ─── */

/** The one card treatment used everywhere: faint top highlight, soft shadow. */
export const CARD_CLASS =
  'rounded-xl border border-white/[0.07] bg-[#0e0e11] ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_10px_30px_-18px_rgba(0,0,0,0.9)]'

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn(CARD_CLASS, className)}>{children}</div>
)

/* ─── section heading (chart cards, panels) ─── */

export const SectionHeading = ({
  title,
  subtitle,
  className,
}: {
  title: string
  subtitle?: string
  className?: string
}) => (
  <div className={cn('min-w-0', className)}>
    <h3 className="truncate text-[13px] font-semibold tracking-tight text-zinc-200">{title}</h3>
    {subtitle && <p className="mt-0.5 truncate text-xs text-zinc-500">{subtitle}</p>}
  </div>
)

/* ─── event badge ─── */

export type EventType = 'HIGH' | 'LOW' | 'VOLUME_SPIKE'

const BADGE_STYLES: Record<EventType, { label: string; className: string }> = {
  HIGH: {
    label: 'HIGH',
    className: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/25',
  },
  LOW: {
    label: 'LOW',
    className: 'bg-red-500/10 text-red-400 ring-red-500/25',
  },
  VOLUME_SPIKE: {
    label: 'VOLUME SPIKE',
    className: 'bg-amber-500/10 text-amber-400 ring-amber-500/25',
  },
}

export const Badge = ({ type }: { type: string }) => {
  const tone = BADGE_STYLES[type as EventType] ?? BADGE_STYLES.VOLUME_SPIKE
  const Icon = type === 'HIGH' ? ArrowUpRight : type === 'LOW' ? ArrowDownRight : Zap
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset',
        tone.className
      )}
    >
      <Icon className="h-3 w-3" />
      {tone.label}
    </span>
  )
}

/* ─── stat card (KPI row) ─── */

const TONES = {
  up: { value: 'text-emerald-400', chip: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20' },
  down: { value: 'text-red-400', chip: 'bg-red-500/10 text-red-400 ring-red-500/20' },
  spike: { value: 'text-amber-400', chip: 'bg-amber-500/10 text-amber-400 ring-amber-500/20' },
  neutral: { value: 'text-zinc-100', chip: 'bg-white/[0.06] text-zinc-400 ring-white/10' },
} as const

export const StatCard = ({
  label,
  value,
  sub,
  icon,
  tone = 'neutral',
  className,
}: {
  label: string
  value: ReactNode
  sub?: string
  icon: ReactNode
  tone?: keyof typeof TONES
  className?: string
}) => {
  const t = TONES[tone]
  return (
    <Card className={cn('flex flex-col justify-between gap-3 p-4 sm:p-5', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          {label}
        </span>
        <span className={cn('rounded-md p-1.5 ring-1 ring-inset', t.chip)}>{icon}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={cn('font-mono text-3xl font-semibold tabular-nums leading-none', t.value)}>
          {value}
        </span>
        {sub && <span className="truncate text-[11px] text-zinc-600">{sub}</span>}
      </div>
    </Card>
  )
}

/* ─── chart card: consistent header, legend slot, height & empty state ─── */

export const ChartLegend = ({ items }: { items: { color: string; label: string }[] }) => (
  <div className="flex shrink-0 items-center gap-3">
    {items.map((item) => (
      <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
        {item.label}
      </span>
    ))}
  </div>
)

export const EmptyState = ({
  icon,
  title,
  hint,
  className,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  className?: string
}) => (
  <div className={cn('flex flex-col items-center justify-center gap-2 text-center', className)}>
    <span className="rounded-lg bg-white/[0.04] p-2 text-zinc-600 ring-1 ring-inset ring-white/[0.06]">
      {icon ?? <Inbox className="h-4 w-4" />}
    </span>
    <p className="text-xs font-medium text-zinc-500">{title}</p>
    {hint && <p className="max-w-[260px] text-[11px] leading-relaxed text-zinc-600">{hint}</p>}
  </div>
)

export const ChartCard = ({
  title,
  subtitle,
  legend,
  height = 260,
  children,
  empty,
  className,
}: {
  title: string
  subtitle?: string
  legend?: { color: string; label: string }[]
  height?: number
  children?: ReactNode
  empty?: { title: string; hint?: string }
  className?: string
}) => (
  <Card className={cn('flex flex-col p-4 sm:p-5', className)}>
    <div className="mb-4 flex items-start justify-between gap-3">
      <SectionHeading title={title} subtitle={subtitle} />
      {legend && <ChartLegend items={legend} />}
    </div>
    <div style={{ height }} className="min-w-0">
      {children ?? <EmptyState className="h-full" title={empty?.title ?? 'No data yet'} hint={empty?.hint} />}
    </div>
  </Card>
)

/* ─── segmented control (filters) ─── */

export const Segmented = <T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
}) => (
  <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/[0.07] bg-white/[0.03] p-0.5">
    {options.map((opt) => (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        aria-pressed={value === opt.value}
        className={cn(
          'rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
          value === opt.value
            ? 'bg-white/[0.1] text-white shadow-sm'
            : 'text-zinc-500 hover:text-zinc-300'
        )}
      >
        {opt.label}
      </button>
    ))}
  </div>
)

/* ─── chart tooltip ─── */

type TooltipDatum = {
  dataKey?: string | number
  name?: string | number
  value?: string | number
  color?: string
}

export const ChartTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipDatum[]
  label?: string | number
}) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-white/10 bg-[#17171a] px-3 py-2 text-xs shadow-xl">
      <p className="mb-1.5 font-mono text-[11px] text-zinc-500">{label}</p>
      <div className="space-y-1">
        {payload.map((p, i) => (
          <p key={p.dataKey ?? i} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
            <span className="font-mono font-semibold text-zinc-100">
              {typeof p.value === 'number' ? p.value.toLocaleString('en-IN') : p.value}
            </span>
          </p>
        ))}
      </div>
    </div>
  )
}
