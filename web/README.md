# SentinelDesk — Web Console

Operator dashboard for SentinelDesk, the AI incident-triage copilot. Next.js (App Router) + Tailwind v4 + shadcn/ui (Base UI) + recharts + zustand. Every page is a client-rendered dashboard: the browser talks to the FastAPI gateway directly (REST + Server-Sent Events).

| Route | What it does |
| --- | --- |
| `/` Console | Compose or pick a sample ticket, then triage it (`POST /api/tickets?wait=true`, ⌘/Ctrl+Enter). Shows the classification, gate decision, latency, PII masking, cited precedents and a grounded draft, with human-in-the-loop actions. |
| `/queue` | Live ticket table with filters and search. New rows flash as they arrive over SSE. Click a row to open the detail sheet (deep link: `/queue?ticket=<id>`). "Simulate traffic" posts to `/api/simulate`. |
| `/outages` | Active and resolved major incidents, each with a timeline of linked tickets and a Resolve button. |
| `/metrics` | Live ops metrics (`/api/metrics`, polled every 5s) and the offline evaluation report (`/api/eval`). |
| `/audit` | Append-only audit log, updated live. |
| `/system` | Architecture diagram with per-service health from `/api/system`. |

## Develop

```bash
npm install
npm run dev                       # http://localhost:3000, gateway at http://localhost:8080
NEXT_PUBLIC_MOCK=1 npm run dev    # no backend: in-browser mock gateway with live events
npm run lint && npm run build
```

### Mock mode
With `NEXT_PUBLIC_MOCK=1`, `lib/api.ts` routes every call to `lib/mock.ts`. That file holds an in-memory gateway with seeded tickets (including an escalated German VPN incident and an auto-drafted English billing ticket), an active outage, an eval report and ops metrics. It also runs a heuristic triage pipeline and emits SSE-style events, so Console triage, the human-review actions and "Simulate traffic" all work offline. The mock state resets when the page does a full reload.

### Without a backend (and not in mock mode)
The UI does not crash. Pages show a **Gateway offline** panel with a Retry button. The event stream reconnects with exponential backoff and reloads the snapshot once the gateway comes back.

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | Gateway base URL. It is inlined at **build** time, and CORS must allow the console origin. |
| `NEXT_PUBLIC_MOCK` | unset | `1` uses the in-browser mock backend. |

The operator name (top bar) is stored in `localStorage` and sent as `operator` on actions. The theme defaults to dark, and the toggle sits in the top bar.

## Code layout

```
app/                 routes (thin server pages that render client views)
components/layout/   shell, sidebar, top bar, outage banner, offline/empty states, theme
components/ticket/   console, composer, triage progress, ticket detail + panels, HITL actions
components/queue/    queue table, filters, simulate menu, detail sheet
components/metrics/  KPI tiles, charts, confusion matrix, ops + eval sections
components/outages/, components/audit/, components/system/
components/ui/       shadcn/ui primitives
lib/types.ts         API contract (verbatim copy of docs/api-types.ts)
lib/api.ts           typed fetch wrappers for every endpoint (+ mock routing)
lib/use-events.ts    EventSource hook with auto-reconnect + store sync
lib/store.ts         zustand store: tickets by id, outages, audit, connection state
lib/mock.ts          mock gateway
```

## Docker (Cloud Run)

```bash
docker build -t sentineldesk-web --build-arg NEXT_PUBLIC_API_URL=https://<gateway-url> .
docker run -p 8080:8080 sentineldesk-web
```

The image uses the Next.js `standalone` output, runs on `node:20-alpine` as a non-root user, and listens on `PORT=8080`.
