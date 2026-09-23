# Market Extremes — NSE 52-Week Monitor

Real-time monitor for Indian stocks hitting their **52-week highs and lows**, with volume-spike (RVOL) alerts, live SSE streaming, and an analytics dashboard — all denominated in ₹.

## Tech stack

| Layer      | Choice |
| ---------- | ------ |
| Frontend   | Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Recharts |
| API        | Next.js Route Handlers (REST + SSE) |
| Database   | SQLite via Prisma (swap `DATABASE_URL` for Postgres in production) |
| Ingestion  | Standalone Node worker (`tsx`), polls every 30 s |
| Data       | `mock` — deterministic NSE simulator (demo) · `yahoo` — real NSE data (`.NS`, no API key) |
| Validation | Zod schemas on every external payload |
| Tests      | Vitest (42 unit tests) |

## Architecture

```
┌──────────────────────────┐        writes         ┌────────────────┐
│  Ingestion worker        │ ─────────────────────▶ │  SQLite (Prisma)│
│  src/services/market-    │                        │  Stock          │
│  ingestion/worker.ts     │                        │  DailyStockState│
│  (own process, 30 s)     │                        │  MarketEvent    │
└───────────┬──────────────┘                        │  QuoteSnapshot  │
            │ eventBus.publish (same-process only)  └───────┬────────┘
            ▼                                               │ poll 2 s
     ┌──────────────┐        subscribe        ┌─────────────▼──────────┐
     │  eventBus    │ ◀────────────────────── │ SSE route + DB bridge   │
     │  (singleton) │                         │ /api/stream             │
     └──────┬───────┘                         └─────────────┬──────────┘
            │  SSE frames                                   │ REST
            ▼                                               ▼
     ┌──────────────────────────────────────────────────────────────┐
     │  Browser: KPI cards · live event feed · charts · drawer      │
     └──────────────────────────────────────────────────────────────┘
```

The worker and the web server run as **separate processes**, so an in-process
event bus alone can never deliver worker events to browsers. `/api/stream`
therefore starts a single background bridge that polls new `MarketEvent` rows
every 2 s and republishes them on the bus — one query total, regardless of how
many browsers are connected. The browser's `EventSource` deduplicates by event
`id`.

## Indian market specifics

- **Exchange**: NSE (symbols stored clean — `RELIANCE`, the Yahoo provider appends `.NS`)
- **Session**: 09:15 – 15:30 IST, Mon–Fri (`Asia/Kolkata`), enforced in market time, never server time
- **Currency**: ₹ formatted with `en-IN` lakh grouping (`₹1,48,235.40`)
- **Charts**: activity bucketed in IST (30-minute buckets), not UTC

## Getting started

```bash
npm install
npx prisma migrate dev        # creates prisma/dev.db
```

**1. Start the ingestion worker** (terminal A)

```bash
npm run worker
```

**2. Start the web app** (terminal B)

```bash
npm run dev
```

Open http://localhost:3000.

By default (`DEMO_MODE=true`, `MARKET_DATA_PROVIDER=mock`) the worker simulates
12 NSE stocks 24/7, so you see events immediately regardless of the day/time.

**Real NSE data** — edit `.env`:

```bash
DEMO_MODE="false"
MARKET_DATA_PROVIDER="yahoo"    # top-20 NSE large caps, no API key needed
```

Then the pipeline only runs during the real NSE session (09:15–15:30 IST).

### Real-data notes (Yahoo provider)

Hard-won details from running the Yahoo provider live — don't "fix" these
without re-verifying against the API:

- **429 rate limiting**: Yahoo's edge throttles bursts hard (no `Retry-After`).
  Quotes are fetched strictly sequentially with a 1s gap and retried with
  exponential backoff (2s/4s/8s). The worker also guards against overlapping
  cycles so a slow pass can't stack on the next tick.
- **User-Agent quirk**: a full Chrome UA *and* curl's default UA both get 429
  from this endpoint, while a bare `Mozilla/5.0` gets 200 — verified seconds
  apart on identical requests. The short UA in `YahooFinanceProvider.ts` is
  intentional; see the comment there.
- **Symbol churn**: delisted/renamed symbols (e.g. `TATAMOTORS.NS` → 404
  post-demerger) 404 rather than 429. `syncUniverse` auto-retires any DB
  symbol missing from the provider universe so dead symbols stop being polled.
- **0 events is normal**: real mode only emits an event when a stock genuinely
  crosses its 52-week boundary. Early in a session expect `stats.total = 0`
  and an empty event feed while quotes/states/snapshots accumulate — check
  the range distribution and the intraday chart to confirm the pipeline.

## Testing

### Unit tests (42 tests)

```bash
npm test           # single run
npm run test:watch # watch mode
```

Coverage:

- `src/lib/market/detection/index.test.ts` — boundary crossings, `CROSSING` vs
  `ONCE_PER_DAY` modes, 3× RVOL threshold, state transitions (ratcheting,
  broken-flag reset, immutability), range-position math
- `src/lib/market/sessions/index.test.ts` — NSE session edges (09:14/09:15,
  15:29/15:30), weekends, timezone correctness, `DEMO_MODE` override
- `src/lib/market/provider/MockMarketDataProvider.test.ts` — NSE/INR universe,
  52-week range integrity, RVOL baseline
- `src/lib/eventBus.test.ts` — fan-out, unsubscribe, listener-error isolation

### Static checks

```bash
npm run lint   # ESLint (0 errors)
npm run build  # type-check + production build
```

### Manual end-to-end checklist

With both processes running:

```bash
# 1. Database reachable
curl http://localhost:3000/api/health
# → {"status":"ok","database":"ok",...}

# 2. Wait ~10 s for two worker cycles, then check the dashboard aggregate
curl -s http://localhost:3000/api/dashboard | jq '.stats, .market'
# → stats.highs / stats.lows climbing, market.isDemo=true, timezone=Asia/Kolkata

# 3. Intraday chart for one symbol
curl -s "http://localhost:3000/api/chart/intraday?symbol=RELIANCE" | jq '{lastPrice, points: (.points | length)}'
# → 400 without ?symbol, 404 for unknown symbol, points > 0 after a few cycles

# 4. Live SSE stream (cross-process bridge) — Ctrl-C to stop
curl -sN http://localhost:3000/api/stream
# → data: {"symbol":"RELIANCE","type":"HIGH",...} frames within a few seconds
```

Then in the browser at http://localhost:3000:

- [ ] KPI cards populate (52W Highs / Lows / Ratio)
- [ ] “DEMO DATA” banner shows while in mock mode (hides automatically on `yahoo`)
- [ ] Event feed updates **without a page refresh** (SSE)
- [ ] Search box + High/Low filter buttons work
- [ ] Clicking a row opens the drawer with an intraday sparkline
- [ ] Date picker switches to HISTORICAL mode (SSE pauses)

### Reset to a clean database

```bash
npx prisma migrate reset --force
```

## Configuration (`.env`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | Prisma datasource (SQLite) |
| `MARKET` / `EXCHANGE` | `IN` / `NSE` | Market identity |
| `TIMEZONE` | `Asia/Kolkata` | Market timezone used everywhere |
| `MARKET_DATA_PROVIDER` | `mock` | `mock` \| `yahoo` |
| `MAX_TRACKED_SYMBOLS` | `20` | Cap on the tracked universe |
| `POLL_INTERVAL_SECONDS` | `30` | Worker cadence |
| `EVENT_MODE` | `CROSSING` | `CROSSING` \| `ONCE_PER_DAY` |
| `DEMO_MODE` | `true` | Force mock provider + 24/7 "market open" |

## Project structure

```
src/
├── app/
│   ├── page.tsx                    # dashboard (client component)
│   └── api/
│       ├── dashboard/route.ts      # aggregates, charts, stats, history
│       ├── chart/intraday/route.ts # last N snapshots per symbol
│       ├── stream/route.ts         # SSE + DB→bus bridge
│       └── health/route.ts         # DB ping
├── lib/
│   ├── prisma.ts                   # singleton Prisma client
│   ├── eventBus.ts                 # typed in-process pub/sub
│   └── market/
│       ├── detection/index.ts      # pure event-detection engine
│       ├── sessions/index.ts       # NSE session/timezone helpers
│       ├── provider/
│       │   ├── MarketDataProvider.ts     # interface
│       │   ├── MockMarketDataProvider.ts # NSE simulator (₹)
│       │   └── YahooFinanceProvider.ts   # real NSE data (.NS)
│       └── models.ts               # normalized types
└── services/
    └── market-ingestion/worker.ts  # standalone polling worker
```

## Data retention

`QuoteSnapshot` is capped at **200 rows per symbol** (pruned every 20 cycles ≈
10 min). `MarketEvent` and `DailyStockState` are kept for history — archive or
partition them before running this against a production universe.
