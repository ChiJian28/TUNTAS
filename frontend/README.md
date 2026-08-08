# TUNTAS Frontend — Decision Cockpit

Turns training spend into provable regulatory readiness.

## Stack

- Next.js 16 App Router + React 19
- TanStack Query / Table / Virtual
- Axios + Zod adapters
- @xyflow/react + dagre (Evidence Spine)
- FullCalendar (Q3 delivery, read-only)
- Motion + light editorial theme (`#FF0009` accent)

## Setup

```bash
cd ambank/frontend
cp .env.example .env.local
npm install
npm run dev
```

Default: [http://localhost:3000](http://localhost:3000) → redirects to `/runs`.

Backend must run on the URL in `NEXT_PUBLIC_TUNTAS_API_BASE_URL` (default `http://localhost:8001`).

### Development auth

```env
NEXT_PUBLIC_TUNTAS_DEMO_AUTH=true
NEXT_PUBLIC_TUNTAS_DEMO_ROLE=manager
NEXT_PUBLIC_TUNTAS_DEMO_ACTOR=demo-manager
```

Requires backend `APP_ENV=development` and `DEMO_AUTH_BYPASS=true`.

Production: set demo auth `false` and configure Supabase publishable URL/key; JWT is attached as Bearer.

## Source of truth

- [`FRONTEND.md`](./FRONTEND.md)
- [`openapi.yaml`](./openapi.yaml) / [`openapi.types.ts`](./openapi.types.ts)

**No mock fallbacks in the runtime path.** If the API is down, the UI shows an error.
