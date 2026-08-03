# PatWaGo

PatWaGo is a self-hosted Jamaica travel companion: public marketing site, real routed `/app/*` customer pages, Patois translation, vendor marketplace, AI itinerary planning, Guardian check-ins, voice concierge, account auth, and paid pass access.

The app is one Node.js process (`server.js`) with vanilla frontend assets in `public/app/`. There is no Vercel/Supabase dependency.

## Main routes

- `/` — public marketing page (`index.html`)
- `/account`, `/account/login`, `/account/paywall` — account and checkout UI
- `/app` — customer dashboard
- `/app/translate` — Gemini-backed Patois translator with local fallback
- `/app/vendors`, `/app/vendor/:id` — searchable Jamaica vendor marketplace
- `/app/trips`, `/app/trips/new` — persistent trip planner and catalog-grounded AI itinerary builder
- `/app/voice` — voice concierge using self-hosted STT and xAI/custom TTS when configured
- `/app/guardian` — persistent safety check-ins
- `/app/profile` — account, active pass, and profile state
- `/admin/analytics` — owner growth console protected by `ADMIN_ANALYTICS_TOKEN`

## Pricing

Server-authoritative prices live in `lib/paypal.js` and never trust client-submitted amounts:

| Plan | Price | Duration |
| --- | ---: | --- |
| Day | $9.99 | 24 hours |
| Week | $29.99 | 7 days |
| Trip | $49.99 | Trip-duration pass, default 7 days |

Pass durations and customer/session storage live in `lib/auth.js`. PayPal order/capture audit persistence lives in `lib/payments.js`.

## Data storage

- Production uses PostgreSQL through `DATABASE_URL`.
- Local/test mode uses in-memory auth/payment stores and JSON-backed seed/state data.
- `data/state.json` is local mutable runtime state and should not be committed.
- Migrations/schema references live in `database/*.sql`.

## Environment

Copy `.env.example` into the private runtime environment and fill keys there only. Never commit a filled `.env`.

Important variables:

- `DATABASE_URL`, `DATABASE_SSL`
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_BASE`, `PAYPAL_WEBHOOK_ID`
- `ADMIN_ANALYTICS_TOKEN`
- `GEMINI_API_KEY`, `GEMINI_MODEL`, `LEGACY_TRANSLATE_URL`
- `XAI_API_KEY`, `XAI_MODEL`, `XAI_VOICE_ID`, `XAI_VOICE_SPEED`
- `WHISPER_URL`, `WHISPER_MODEL`, `TTS_BASE_URL`, `TTS_MODEL`, `TTS_VOICE`
- Optional rate limits: `LOGIN_RATE_WINDOW_MS`, `LOGIN_RATE_MAX`, `REGISTER_RATE_WINDOW_MS`, `REGISTER_RATE_MAX`

## Voice services

Optional speech-to-text infrastructure is self-hosted with Speaches/faster-whisper:

```bash
docker compose -f deploy/voice-services.compose.yml up -d
```

Keep voice services bound to localhost and proxy through PatWaGo's own API.

## Security hardening included

- Path traversal protection for both `public/` and root static-serving branches.
- Server-side password minimum and tight login/register rate limiting.
- Opaque HttpOnly session cookies with 7-day TTL.
- PayPal order/capture persistence and webhook reconciliation fallback.
- Server-authoritative pricing for every pass.
- Syntax check coverage for every shipped JS file in `server.js`, `lib/`, and `public/app/`.

## Development

```bash
npm install
npm run check
npm test
npm start
```

Expected verification at this build: `npm run check` covers 16 JS files, and `npm test` passes 125 tests.

## Deployment

The corrected Traefik dynamic config is `apps/yaadie-web/patwago.traefik.yaml`. Before installing it on the VPS, verify the real app process and port with `docker ps` / `systemctl status`; the checked-in config points to the documented `server.js` default port `3000`.
