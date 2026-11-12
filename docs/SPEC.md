# Hookline: Specification

> Hand this file to the coding agent as the project brief. Save it in the repository as `docs/SPEC.md`.

## 1. Product

**What it is.** A self-hosted webhook relay and inspector for development and staging. You create an
endpoint, point a provider (GitHub, Stripe test mode, your own services) at its URL, and Hookline
stores every request, verifies its HMAC signature, forwards it to one or more destinations with
retries, and lets you inspect, replay or dead-letter deliveries from a dashboard.

**Who it is for.** Developers integrating webhooks who need to see exactly what arrived, test their
handlers against real payloads, and survive their local server being down.

**Intended use.** Development and test traffic. The README must say that Hookline is not meant to
carry production personal data, and Phase 1 ships with header redaction and a short retention window.

## 2. Architecture

pnpm workspaces monorepo, Node.js 24 LTS, strict TypeScript.

```
hookline/
├── apps/
│   ├── api/        # NestJS: ingest endpoint, management API, SSE live tail
│   ├── dispatcher/ # NestJS standalone: outbox relay + BullMQ delivery workers
│   └── web/        # Next.js App Router dashboard
├── packages/
│   ├── signatures/ # pure HMAC verification (generic, GitHub, Stripe formats)
│   ├── retry/      # pure backoff schedule with jitter
│   └── shared/     # zod schemas and types
├── docker-compose.yml  # postgres + redis
└── .github/workflows/ci.yml
```

- **Database:** PostgreSQL with Prisma. **Queue:** Redis + BullMQ.
- **Transactional outbox:** the ingest request writes `InboundRequest`, one `Delivery` per destination
  and one `OutboxEvent` in a single transaction. The dispatcher reads unpublished outbox events and
  enqueues delivery jobs, so a crash between "saved" and "queued" never loses a delivery.

## 3. Data model (Phase 1)

| Model | Key fields | Notes |
|---|---|---|
| `Endpoint` | id, name, slug (unique, random), signingScheme (`none`, `generic_sha256`, `github`, `stripe`), signingSecretEnc, dedupeHeader (nullable), createdAt | Ingest URL is `/in/:slug` |
| `Destination` | id, endpointId, url, enabled, timeoutMs, maxAttempts | |
| `InboundRequest` | id, endpointId, method, path, query, headers (jsonb, redacted), body (bytea, max 256 KB), contentType, signatureStatus (`valid`, `invalid`, `not_configured`), dedupeKey (nullable), receivedAt | Unique `(endpointId, dedupeKey)` when present |
| `Delivery` | id, inboundRequestId, destinationId, status (`PENDING`, `IN_FLIGHT`, `SUCCEEDED`, `FAILED_RETRYING`, `DEAD`), attemptCount, nextAttemptAt | |
| `DeliveryAttempt` | id, deliveryId, attemptNumber, startedAt, durationMs, responseStatus, responseBodySnippet (2 KB), error | |
| `OutboxEvent` | id, type, payload (jsonb), createdAt, publishedAt (nullable) | Index on `publishedAt IS NULL` |

Signing secrets are encrypted at rest with a key from `HOOKLINE_ENCRYPTION_KEY` (AES-256-GCM).

## 4. Behaviour rules

- **Ingest** (`ANY /in/:slug`) always answers fast: `202` once stored, `404` for unknown slug,
  `413` over 256 KB. It never waits for destinations.
- **Signature verification** uses constant-time comparison. An invalid signature is still stored
  (visible in the inspector) but not forwarded unless the endpoint allows it.
- **Dedupe:** if `dedupeHeader` is set (for example `X-GitHub-Delivery`), a repeated value returns
  `200` and creates no new deliveries.
- **Retries:** exponential backoff with full jitter (base 2 s, cap 10 min) up to `maxAttempts`
  (default 8); then status `DEAD`. Retry on network errors, timeouts, `408`, `429` and `5xx`; respect
  `Retry-After`. `4xx` other than those is a final failure.
- **Forwarding** preserves method, body and content type, adds `X-Hookline-Delivery-Id` and
  `X-Hookline-Attempt`, and strips hop-by-hop headers.
- **SSRF protection:** destinations resolving to private, loopback or link-local ranges are rejected
  unless `ALLOW_PRIVATE_DESTINATIONS=true` (default true only in development, documented). DNS is
  checked at delivery time, not only on save.
- **Redaction:** `Authorization`, `Cookie` and headers listed in `REDACT_HEADERS` are replaced with
  `[redacted]` before storage.
- **Retention:** a scheduled job deletes requests older than `RETENTION_DAYS` (default 7).
- **Replay:** creates a new `Delivery` for the same request; never mutates past attempts.

## 5. API (Phase 1)

Errors as `{ code, message }` with stable codes (`ENDPOINT_NOT_FOUND`, `PAYLOAD_TOO_LARGE`,
`DESTINATION_NOT_ALLOWED`, `DELIVERY_NOT_REPLAYABLE`).

| Method | Path | Description |
|---|---|---|
| `ANY` | `/in/:slug` | Ingest |
| `GET/POST` | `/api/endpoints` | List / create endpoints |
| `GET/PATCH/DELETE` | `/api/endpoints/:id` | Endpoint detail, update, delete |
| `POST/PATCH/DELETE` | `/api/endpoints/:id/destinations[/:destId]` | Manage destinations |
| `GET` | `/api/endpoints/:id/requests?cursor=` | Cursor-paginated request list |
| `GET` | `/api/requests/:id` | Request detail with deliveries and attempts |
| `POST` | `/api/deliveries/:id/replay` | Replay one delivery |
| `POST` | `/api/endpoints/:id/requests/:reqId/replay` | Replay to all enabled destinations |
| `GET` | `/api/endpoints/:id/stream` | Server-Sent Events: new requests and delivery status changes |
| `GET` | `/health` | Liveness, plus outbox lag and queue depth |

Phase 1 management API and dashboard are protected by a single admin password (hash in
`ADMIN_PASSWORD_HASH`) and an HttpOnly session cookie.

## 6. Dashboard (Phase 1)

- Endpoints list with ingest URL (copy button), signature scheme and last request time.
- Endpoint page with a **live tail** of requests (SSE), filters by signature status and delivery status.
- Request inspector: headers, pretty-printed body (JSON, form, raw), signature result, delivery timeline with each attempt.
- Replay buttons with confirmation.
- Dead-letter view: all `DEAD` deliveries with bulk replay.
- Loading, empty, error and reconnecting states for the live tail.

## 7. Phase 1 build order (commit after each step)

1. Repo hygiene: LICENSE, README skeleton, `.gitignore`, `.env.example`, pnpm workspace, lint/format/TS config, CI.
2. Docker Compose, Prisma schema, first migration, seed with made-up endpoints and sample payloads.
3. `packages/signatures` and `packages/retry` with thorough unit tests (known-good signature vectors for GitHub and Stripe formats, jitter bounds, `Retry-After`).
4. Ingest endpoint with transactional outbox, dedupe and redaction; integration tests against real Postgres.
5. Dispatcher: outbox relay, delivery worker, retry scheduling, `DEAD` status; tests with a local stub HTTP server, including a crash between commit and enqueue.
6. SSRF guard with tests for private ranges, IPv6 and DNS rebinding at delivery time.
7. Management API, replay and SSE stream.
8. Dashboard pages and states.
9. Playwright E2E: create endpoint, send a webhook with curl, see it in the live tail, watch a retry succeed.
10. Retention job, README complete, ROADMAP.md, `docs/ISSUES.md`.

**Stop after step 10.** Do not implement roadmap items.

## 8. Roadmap (write to ROADMAP.md and docs/ISSUES.md, do not implement)

Each item needs a title, problem, scope and acceptance criteria.

1. CLI `hookline listen --forward http://localhost:3000/webhooks` that tunnels deliveries to a local machine over WebSocket.
2. Transformations: JSONata or JS sandbox to reshape payloads per destination.
3. Destination filters by header or JSON path.
4. Circuit breaker per destination with automatic pause and resume.
5. Rate limiting per destination.
6. Multi-user auth (GitHub OAuth) and teams.
7. Outgoing request signing so destinations can verify Hookline.
8. Metrics endpoint for Prometheus and an OpenTelemetry trace per delivery.
9. Payload search (full text on body) with a size-aware index.
10. Export a request as a cURL command or a test fixture file.
11. More signature formats (Shopify, Slack, Twilio).
12. Ordered delivery mode per endpoint (FIFO by received time).
13. Load test: 500 requests/s ingest with p95 under 50 ms; document results.
14. Docker image and deploy guide.

## 9. Repository rules (apply to all work)

- **License:** MIT, `Copyright (c) 2026 fernandaquerino`, in `LICENSE` at the root.
- **README:** what it does, who it is for, intended use (dev/test traffic), stack, how to run, how to test, status, link to ROADMAP.md.
- **Secrets:** never commit secrets. Only `.env.example` with placeholders; `.env*` (except `.env.example`) in `.gitignore`.
- **Data:** only made-up sample payloads. No real personal or customer data.
- **Git:** commit after each completed step with Conventional Commits. Do not squash, rewrite history, backdate commits or force-push. Use the git identity already configured on the machine.
- **Quality gates before each commit:** lint, typecheck, tests and build pass. Report only commands that were actually run.
- **Scope:** small, focused files; no business logic in controllers; no `any` or `@ts-ignore` without a written reason.
