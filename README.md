# Hookline

Self-hosted webhook relay and inspector for development and staging.

You create an endpoint and point a provider (GitHub, Stripe test mode, your own services) at its
ingest URL. Hookline stores every request, verifies its HMAC signature, forwards it to one or more
destinations with retries, and lets you inspect, replay or dead-letter deliveries from a dashboard.

> [!WARNING]
> **Intended use: development and test traffic only.** Hookline is not meant to carry production
> personal data. It redacts `Authorization`, `Cookie` and any headers you list before storing
> anything, and deletes stored requests after a short retention window (7 days by default), but it
> is a debugging tool, not a hardened production gateway.

## Who it is for

Developers integrating webhooks who need to:

- see exactly what arrived: headers, raw body, signature result;
- test their handlers against real provider payloads, again and again (replay);
- survive their local server being down: deliveries are retried with backoff and dead-lettered
  instead of lost.

## Status

**Phase 1 is complete.** Ingest, signature verification, transactional outbox, retries, SSRF
protection, the management API, the live dashboard, retention and the test suites are implemented.
Planned work is in [ROADMAP.md](ROADMAP.md); issue-ready drafts and known Phase 1 limitations are in
[docs/ISSUES.md](docs/ISSUES.md). The original brief is [docs/SPEC.md](docs/SPEC.md).

## Stack

- **Node.js 24**, strict TypeScript, **pnpm** workspaces
- **API**: NestJS 11 (ingest, management API, Server-Sent Events)
- **Dispatcher**: NestJS standalone app, **BullMQ** on **Redis**, **undici** for outgoing requests
- **Database**: **PostgreSQL** with **Prisma** 6
- **Dashboard**: **Next.js** 15 App Router, React 19
- **Tests**: Vitest (unit and integration against real Postgres and Redis), Playwright (E2E)

## How it works

```
provider ──POST /in/:slug──▶ API ──one transaction──▶ Postgres
                              │      InboundRequest + Delivery per destination + OutboxEvent
                              │
                              └─ 202 immediately (never waits for destinations)

dispatcher: outbox relay ──▶ BullMQ ──▶ worker ──HTTP──▶ destination
              ▲                           │
              └── retry = new OutboxEvent ┘ (full-jitter backoff, Retry-After, max attempts → DEAD)

API ◀── Redis pub/sub ── API and dispatcher ── live events ──▶ dashboard (SSE)
```

- **Transactional outbox.** Ingest writes the request, one delivery per enabled destination and an
  outbox event in one transaction. The dispatcher relays unpublished events to BullMQ
  (`FOR UPDATE SKIP LOCKED`, deterministic job ids), so a crash between "saved" and "queued" never
  loses a delivery, and a crash after enqueueing never delivers twice. Retries and replays go
  through the outbox too.
- **Idempotent workers.** A worker claims a delivery with a conditional update for the exact
  attempt number; duplicate or stale jobs are no-ops. Deliveries left `IN_FLIGHT` by a crashed
  worker are recovered after `STALE_IN_FLIGHT_MS`.
- **Retries.** Exponential backoff with full jitter (base 2 s, cap 10 min), up to `maxAttempts`
  (default 8), then `DEAD`. Network errors, timeouts, `408`, `429` and `5xx` are retried and
  `Retry-After` is honoured as a minimum (clamped to the cap). Other `4xx` and `3xx` (redirects are
  not followed) are final.
- **Forwarding.** Method, body and content type are preserved; `X-Hookline-Delivery-Id` and
  `X-Hookline-Attempt` are added; hop-by-hop headers, `Host`, `Content-Length` and redacted headers
  are not forwarded.
- **SSRF protection.** Destinations on private, loopback, link-local, CGNAT, multicast and other
  reserved ranges (IPv4 and IPv6, including IPv4-mapped, NAT64 and 6to4 forms) are rejected on save
  **and at delivery time**: the dispatcher resolves DNS in the socket's connect step and connects to
  the address it checked, which defeats DNS rebinding. Set `ALLOW_PRIVATE_DESTINATIONS=true` to
  allow private targets; it defaults to `true` only when `NODE_ENV=development`.
- **Replay** creates a new delivery linked to the original (`replayOfId`); past deliveries and
  attempts are never modified.

### Repository layout

```
apps/
  api/          NestJS: ingest, management API, SSE live stream, /health
  dispatcher/   NestJS standalone: outbox relay, BullMQ workers, retention job
  web/          Next.js dashboard
packages/
  db/           Prisma schema, migrations, client, AES-256-GCM secret helpers, seed
  shared/       zod schemas, DTO types, error codes, outbox/queue/live-event contracts
  signatures/   pure HMAC verification: generic SHA-256, GitHub, Stripe
  retry/        pure backoff schedule, Retry-After parsing, attempt classification
  ssrf/         IP range checks, URL rules, connect-time DNS guard
e2e/            Playwright suite and its stub destination
```

`packages/db` and `packages/ssrf` were added beyond the spec's three packages so the Prisma client
and the SSRF guard can be shared by the API and the dispatcher without leaking Node-only code into
the dashboard.

## Running locally

Prerequisites: Node.js 24, pnpm 10 (`corepack enable` works), Docker (or a local PostgreSQL 16 and
Redis 7), and `curl` for trying it out.

```bash
pnpm install
```

```bash
docker compose up -d
```

`docker compose` starts PostgreSQL (with a `hookline` and a `hookline_test` database) and Redis on
their default ports.

Create `.env` from the example and fill in the three secrets:

```bash
cp .env.example .env
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put that value in `HOOKLINE_ENCRYPTION_KEY`, put any long random string in `SESSION_SECRET`, then
build and generate the admin password hash:

```bash
pnpm build
```

```bash
pnpm --filter @hookline/api hash-password 'choose-a-password'
```

Put the output in `ADMIN_PASSWORD_HASH`. Then apply migrations, load the made-up demo data and
start everything (API on :4000, dashboard on :3000, dispatcher in the background):

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

```bash
pnpm dev
```

Open <http://localhost:3000>, sign in, open an endpoint and send it a webhook:

```bash
curl -X POST http://localhost:4000/in/demo-orders-2b8n6c -H 'Content-Type: application/json' -d '{"hello":"world"}'
```

It appears in the live tail immediately. The demo destinations point at
`http://localhost:4010/webhooks`; until something listens there you will see the delivery retry.

To run the built apps instead of watch mode: `pnpm --filter @hookline/api start`,
`pnpm --filter @hookline/dispatcher start` and `pnpm --filter @hookline/web start`.

> [!NOTE]
> The dashboard proxies `/api/*` to `API_URL`, and Next.js reads that value **at build time**. Set
> `API_URL` before `pnpm build` if the API is not on `http://localhost:4000`.

### Configuration

All settings are environment variables; see [.env.example](.env.example).

| Variable                         | Used by          | Default                             | Purpose                                                  |
| -------------------------------- | ---------------- | ----------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`                   | api, dispatcher  | (required)                          | PostgreSQL connection string                             |
| `REDIS_URL`                      | api, dispatcher  | `redis://localhost:6379`            | Queue and live events                                    |
| `QUEUE_PREFIX`                   | api, dispatcher  | `hookline`                          | BullMQ key prefix (must match)                           |
| `HOOKLINE_ENCRYPTION_KEY`        | api              | (required)                          | 32 bytes, base64; encrypts signing secrets (AES-256-GCM) |
| `ADMIN_PASSWORD_HASH`            | api              | (required)                          | scrypt hash from `hash-password`                         |
| `SESSION_SECRET`                 | api              | (required)                          | Signs the session cookie; rotate to sign everyone out    |
| `API_PORT`                       | api              | `4000`                              | HTTP port                                                |
| `PUBLIC_INGEST_BASE_URL`         | api              | `http://localhost:4000`             | Base of the ingest URLs shown in the dashboard           |
| `REDACT_HEADERS`                 | api              | (empty)                             | Extra headers to redact, comma separated                 |
| `ALLOW_PRIVATE_DESTINATIONS`     | api, dispatcher  | `true` in development, else `false` | Allow private/loopback destinations                      |
| `RETRY_BASE_MS` / `RETRY_CAP_MS` | dispatcher       | `2000` / `600000`                   | Backoff base and cap                                     |
| `RETENTION_DAYS`                 | dispatcher       | `7`                                 | Delete requests older than this                          |
| `RETENTION_INTERVAL_MS`          | dispatcher       | `3600000`                           | How often retention runs                                 |
| `OUTBOX_POLL_MS`                 | dispatcher       | `500`                               | Outbox relay interval                                    |
| `WORKER_CONCURRENCY`             | dispatcher       | `10`                                | Parallel deliveries per dispatcher                       |
| `STALE_IN_FLIGHT_MS`             | dispatcher       | `300000`                            | When an `IN_FLIGHT` delivery counts as interrupted       |
| `API_URL`                        | web (build time) | `http://localhost:4000`             | Where the dashboard proxies `/api`                       |

### Signature schemes

| Scheme           | Header                                            | Signed content                      |
| ---------------- | ------------------------------------------------- | ----------------------------------- |
| `generic_sha256` | `X-Signature-256: sha256=<hex>` (prefix optional) | raw body                            |
| `github`         | `X-Hub-Signature-256: sha256=<hex>`               | raw body                            |
| `stripe`         | `Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]`      | `"<t>.<raw body>"`, 300 s tolerance |

All comparisons are constant time. A request with an invalid signature is stored and shown in the
inspector but not forwarded, unless the endpoint has "forward invalid signatures" enabled; it also
cannot claim a dedupe key.

## API

Errors are always `{ "code": "...", "message": "..." }` with stable codes such as
`ENDPOINT_NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `DESTINATION_NOT_ALLOWED`, `DELIVERY_NOT_REPLAYABLE`,
`VALIDATION_FAILED` and `UNAUTHORIZED`. Everything under `/api` except login requires the
`hookline_session` cookie (HttpOnly, SameSite=Lax, Secure in production).

| Method             | Path                                                                          | Description                                                                           |
| ------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `ANY`              | `/in/:slug`                                                                   | Ingest: `202` stored, `200` duplicate (dedupe), `404` unknown slug, `413` over 256 KB |
| `POST`             | `/api/auth/login`, `/api/auth/logout`                                         | Sign in with the admin password / sign out                                            |
| `GET`              | `/api/auth/session`                                                           | Check the session                                                                     |
| `GET/POST`         | `/api/endpoints`                                                              | List / create endpoints                                                               |
| `GET/PATCH/DELETE` | `/api/endpoints/:id`                                                          | Endpoint detail, update, delete                                                       |
| `POST`             | `/api/endpoints/:id/destinations`                                             | Add a destination (SSRF-checked)                                                      |
| `PATCH/DELETE`     | `/api/endpoints/:id/destinations/:destId`                                     | Update / remove a destination                                                         |
| `GET`              | `/api/endpoints/:id/requests?cursor=&limit=&signatureStatus=&deliveryStatus=` | Cursor-paginated requests, newest first                                               |
| `GET`              | `/api/requests/:id`                                                           | Request detail with deliveries and attempts                                           |
| `POST`             | `/api/deliveries/:id/replay`                                                  | Replay one finished delivery                                                          |
| `POST`             | `/api/endpoints/:id/requests/:reqId/replay`                                   | Replay to all enabled destinations                                                    |
| `GET`              | `/api/deliveries?status=DEAD&cursor=`                                         | Dead-letter list (added for the dashboard)                                            |
| `POST`             | `/api/deliveries/replay`                                                      | Bulk replay `{ "deliveryIds": [...] }`, up to 100 (added for the dashboard)           |
| `GET`              | `/api/endpoints/:id/stream`                                                   | Server-Sent Events: `request.received`, `delivery.updated`                            |
| `GET`              | `/health`                                                                     | Database and Redis status, outbox lag, queue depth (`503` when degraded)              |

## Testing

| Command             | What it runs                                                |
| ------------------- | ----------------------------------------------------------- |
| `pnpm lint`         | ESLint (TypeScript, React hooks) with zero warnings allowed |
| `pnpm format:check` | Prettier                                                    |
| `pnpm typecheck`    | `tsc --noEmit` in every package                             |
| `pnpm test`         | Unit and integration tests (Vitest)                         |
| `pnpm build`        | Builds every package and app                                |
| `pnpm e2e`          | Builds, then runs the Playwright suite                      |

Integration tests use a real PostgreSQL database and Redis. They refuse to run against a database
whose name does not end in `_test`; by default they use
`postgresql://hookline:hookline@localhost:5432/hookline_test` (override with `TEST_DATABASE_URL`
and `TEST_REDIS_URL`) and apply migrations themselves. They cover, among others: atomic ingest with
a forced outbox failure, dedupe under concurrency, the 256 KB limit, crashes between commit and
enqueue, duplicate jobs, interrupted deliveries, retries with `Retry-After`, SSRF checks for
private, IPv6 and rebinding addresses through the real HTTP client, replay, SSE and retention.

The E2E suite starts a stub destination that fails every first attempt, the API, the dispatcher and
a production build of the dashboard on ports 4110, 4100 and 3100, against a `hookline_e2e`
database it creates and resets (`E2E_DATABASE_URL` to override). It signs in, creates an endpoint
and destination, sends a webhook with `curl`, watches it appear in the live tail, sees the retry
succeed, checks the inspector, and replays the delivery. If Playwright's browser is not installed:
`pnpm --filter @hookline/e2e exec playwright install chromium`.

CI (`.github/workflows/ci.yml`) runs lint, format check, typecheck, tests and build, then the E2E
suite, against PostgreSQL and Redis service containers.

## Security notes

- Signing secrets are encrypted at rest with AES-256-GCM and are never returned by the API.
- `Authorization`, `Cookie` and `REDACT_HEADERS` are replaced with `[redacted]` before storage
  and are not forwarded.
- The admin password is stored only as an scrypt hash; sign-in attempts are rate limited per client.
- Sessions are stateless signed cookies valid for 12 hours. Signing out clears the cookie;
  rotating `SESSION_SECRET` invalidates every session.
- Keep `ALLOW_PRIVATE_DESTINATIONS=false` anywhere other people can create destinations.
- The seed and all tests use made-up data only.

## License

[MIT](LICENSE), Copyright (c) 2026 fernandaquerino.
