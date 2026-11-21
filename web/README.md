# SentinelDesk — Web Console

Operator dashboard for SentinelDesk, the AI incident-triage copilot. Next.js (App Router) + Tailwind v4 + shadcn/ui (Base UI) + recharts + zustand. Every page is a client-rendered dashboard: the browser talks to the FastAPI gateway directly (REST + Server-Sent Events).

Jira-style service-desk UI (light theme by default, dark mode in the top bar).

| Route | What it does |
| --- | --- |
| `/` Board | Kanban board derived from ticket fields: **Triage** (queued/processing/failed) → **Escalated · On-call** (gate escalated, awaiting a human) → **AI draft · Needs review** (auto-draft awaiting a human) → **Done** (any human action). Quick filters, search, live SSE arrivals, "Simulate traffic". |
| `/tickets` | Issue-navigator table: sortable columns, filters, search. |
| `/tickets/[id]` | Full-page ticket view (deep link). |
| `?ticket=<id>` on any page | Opens the ticket in a large right-side panel: description (+ "Show what the AI saw" PII view), escalation decision in plain English, AI draft with clickable citations, similar past tickets, activity feed, Jira-style details sidebar, and the human actions (Approve & send, Edit reply, Reject, Acknowledge escalation, Override fields). |
| `/incidents` | Major incidents (outages) with linked tickets and Resolve. |
| `/reports` | Live ops metrics (`/api/metrics`, polled) + offline evaluation (`/api/eval`). |
| `/audit` | Append-only audit log in plain English, updated live. |
| `/system` | Architecture diagram (incl. the on-call notifier) with per-service health. |

The top bar has global search (`/` to focus), the **Create** button (modal → `POST /api/tickets?wait=true` with staged progress, then opens the new ticket), connection status, operator name and theme toggle.

Old URLs redirect (query strings preserved): `/queue` → `/tickets` (so on-call phone alerts linking to `/queue?ticket=<id>` still open the ticket), `/outages` → `/incidents`, `/metrics` → `/reports`.

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

The operator name (top bar) is stored in `localStorage` and sent as `operator` on actions. The theme defaults to light, and the toggle sits in the top bar.

## Code layout

```
app/                 routes (thin server pages that render client views)
components/layout/   shell, sidebar, top bar (global search, Create), outage banner, offline/empty states, theme
components/jira/     Jira-style primitives: lozenge, priority + issue-type icons, component tag, avatar
components/board/    board view + issue card
components/issue/    issue view (header, actions, description, escalation callout, draft tab, activity, details sidebar), panel host, full page
components/create/   "Create ticket" modal
components/tickets/  issue-navigator table
components/ticket/   shared ticket pieces: citation text, precedents list, override dialog, triage progress, badges, actions hook
components/queue/    simulate-traffic menu, filter select
components/metrics/, components/outages/, components/audit/, components/system/
components/ui/       shadcn/ui primitives
lib/types.ts         API contract (verbatim copy of docs/api-types.ts)
lib/api.ts           typed fetch wrappers for every endpoint (+ mock routing)
lib/issue.ts         board columns, status lozenges, issue keys/summaries (derived from ticket fields)
lib/semantics.ts     labels, colors, plain-English reason-code explanations
lib/use-events.ts    EventSource hook with auto-reconnect + store sync
lib/store.ts         zustand store: tickets by id, outages, audit, connection state
lib/ui-store.ts      UI-only state (Create modal)
lib/use-issue-nav.ts open/close the ticket panel via ?ticket=<id>
lib/mock.ts          mock gateway
```

## Docker (Cloud Run)

```bash
docker build -t sentineldesk-web --build-arg NEXT_PUBLIC_API_URL=https://<gateway-url> .
docker run -p 8080:8080 sentineldesk-web
```

The image uses the Next.js `standalone` output, runs on `node:20-alpine` as a non-root user, and listens on `PORT=8080`.
