# Issues

Issue-ready drafts, to be filed in the tracker. Part A lists known limitations of Phase 1 found
while building it. Part B turns each [roadmap](../ROADMAP.md) item into an issue; the roadmap has
the longer scope discussion. Nothing here is implemented yet.

Labels used: `bug`, `limitation`, `enhancement`, `security`, `dx` (developer experience), `ops`.

---

## Part A: known Phase 1 limitations

### A1. Dashboard reads `API_URL` at build time

Labels: `limitation`, `ops`

**Problem.** The dashboard proxies `/api/*` with a Next.js rewrite, and Next.js bakes rewrite
targets into the build. Changing where the API lives means rebuilding the dashboard; the E2E suite
rebuilds it for that reason (into `.next-e2e`).

**Scope.** Replace the rewrite with a small runtime proxy (a route handler that streams requests,
including SSE, to `process.env.API_URL`), or serve the dashboard from the API origin.

**Acceptance criteria.**

- One dashboard build works against different `API_URL` values set at `next start`.
- SSE still streams without buffering (verified by the E2E live-tail test).

### A2. Sessions cannot be revoked individually

Labels: `limitation`, `security`

**Problem.** Sessions are stateless signed cookies (12 h). Signing out clears the browser cookie,
but a copied cookie stays valid until it expires; the only global revocation is rotating
`SESSION_SECRET`.

**Scope.** Server-side session records (Postgres or Redis) checked by the auth guard; logout
deletes the record. Folds into roadmap item 6.

**Acceptance criteria.**

- After logout, replaying the old cookie returns `401 UNAUTHORIZED`.
- A "sign out everywhere" action invalidates all sessions without changing `SESSION_SECRET`.

### A3. Login rate limiting is per process

Labels: `limitation`, `security`

**Problem.** The sign-in limiter (10 attempts per minute per client address) is in memory, so it
resets on restart and is not shared between API instances. Behind a proxy, `req.ip` is the proxy's
address unless Express `trust proxy` is configured, which Phase 1 does not do. Dashboard sign-ins
arrive through the Next.js `/api` proxy, so in practice they all share one bucket: ten wrong
passwords in a minute briefly lock out every dashboard user.

**Scope.** Move the counter to Redis; add a `TRUST_PROXY` setting.

**Acceptance criteria.**

- The limit holds across two API instances and across a restart.
- With `TRUST_PROXY` set, the limit applies per client, not per proxy.

### A4. Removing a destination deletes its delivery history

Labels: `limitation`

**Problem.** `Delivery.destinationId` cascades on delete, so removing a destination also removes
its deliveries and attempts from every stored request. The dashboard warns, but disabling is the
only history-preserving option.

**Scope.** Soft-delete destinations (`deletedAt`), hide them from lists and from new deliveries,
and keep their deliveries visible in the inspector.

**Acceptance criteria.**

- After removing a destination, past deliveries to it still show in the request inspector.
- Removed destinations receive no new deliveries or replays.

### A5. The outbox partial index lives outside the Prisma schema

Labels: `limitation`, `dx`

**Problem.** Prisma 6 cannot declare partial indexes, so
`OutboxEvent_unpublished_idx ... WHERE "publishedAt" IS NULL` exists only in the first SQL
migration. Prisma ignores it today, but a future migration generated with `migrate dev` could drop
it unnoticed, slowing the relay.

**Scope.** A test that asserts the index exists after migrations, and a note in the contributing
guide; revisit when Prisma supports partial indexes.

**Acceptance criteria.**

- CI fails if the partial index is missing after `prisma migrate deploy`.

### A6. Live events are best effort

Labels: `limitation`

**Problem.** Live updates go over Redis pub/sub, which does not buffer. If the dashboard is
disconnected, it refetches only the first page on reconnect; updates to older rows that happened
while offline are not shown until the page is reloaded. Requests are never lost from the database.

**Scope.** Add SSE `Last-Event-ID` support backed by a short Redis stream per endpoint, or refetch
visible rows on reconnect.

**Acceptance criteria.**

- After a 30 s disconnect, every request and delivery status change from that window is reflected
  without a page reload.

### A7. Credentials cannot be forwarded to destinations

Labels: `limitation`, `dx`

**Problem.** Redacted headers (`Authorization`, `Cookie`, `REDACT_HEADERS`) are removed before
storage, so they cannot be forwarded. Destinations that need their own credentials have no way to
receive them.

**Scope.** Per-destination extra headers (encrypted at rest, never shown after save), added when
forwarding.

**Acceptance criteria.**

- A destination configured with `Authorization: Bearer …` receives it on every attempt and replay.
- The value never appears in API responses, logs or the inspector.

### A8. Ingest subpaths and query strings are not forwarded

Labels: `limitation`

**Problem.** Only `/in/:slug` is accepted (no subpaths), and the stored query string is not
appended to the destination URL. Providers that encode information in the path or query lose it
on forwarding (it is still visible in the inspector).

**Scope.** Accept `/in/:slug/*rest`; an opt-in per destination to append the subpath and query.

**Acceptance criteria.**

- `POST /in/abc/github/events?x=1` is stored with its full path and query, and a destination with
  the option enabled receives `/<its path>/github/events?x=1`.

### A9. Retention runs on every dispatcher instance

Labels: `limitation`, `ops`

**Problem.** Each dispatcher runs the retention job on its own timer. The deletes are idempotent,
so this is safe, but with many instances it is wasted work.

**Scope.** Take a Postgres advisory lock (or a BullMQ repeatable job) so one instance runs it per
interval.

**Acceptance criteria.**

- With three dispatchers running, retention executes once per interval (checked through logs or a
  metric).

---

## Part B: roadmap items

Each issue links to its section in [ROADMAP.md](../ROADMAP.md) for the full scope.

### B1. CLI `hookline listen --forward` over WebSocket

Labels: `enhancement`, `dx`. Roadmap: [1](../ROADMAP.md#1-cli-tunnel-hookline-listen---forward)

**Problem.** Hookline cannot reach a developer's laptop, so local handlers cannot receive webhooks
through it.

**Scope.** CLI package, authenticated WebSocket from CLI to API, `tunnel` destination type, local
HTTP request performed by the CLI with the result recorded as a normal attempt.

**Acceptance criteria.**

- [ ] With the CLI connected, a webhook reaches the local server and the attempt is recorded.
- [ ] With the CLI disconnected, deliveries retry and succeed after it reconnects.
- [ ] Revoked tokens close the tunnel.
- [ ] E2E test with the CLI and a local stub.

### B2. Payload transformations per destination

Labels: `enhancement`. Roadmap: [2](../ROADMAP.md#2-payload-transformations-per-destination)

**Problem.** Destinations sometimes need a different payload shape than the provider sends.

**Scope.** JSONata transformation on a destination, run in the dispatcher with time and memory
limits; preview in the dashboard.

**Acceptance criteria.**

- [ ] Only destinations with a transformation receive the transformed body.
- [ ] Transformation errors are final failures with the message recorded.
- [ ] Runaway expressions stop within the timeout.
- [ ] Preview works against a stored request without creating a delivery.

### B3. Destination filters by header or JSON path

Labels: `enhancement`. Roadmap: [3](../ROADMAP.md#3-destination-filters-by-header-or-json-path)

**Problem.** Every destination receives every event of its endpoint.

**Scope.** Per-destination all/any rules on headers and JSON paths, evaluated at ingest.

**Acceptance criteria.**

- [ ] Non-matching destinations get no delivery and the inspector shows why.
- [ ] Invalid rules are rejected on save with `VALIDATION_FAILED`.
- [ ] Unit tests for the evaluator and an ingest integration test.

### B4. Circuit breaker per destination

Labels: `enhancement`, `ops`. Roadmap: [4](../ROADMAP.md#4-circuit-breaker-per-destination)

**Problem.** A down destination receives a retry for every delivery.

**Scope.** Consecutive-failure threshold opens the circuit; cool-down; half-open probe; manual
reset in the dashboard.

**Acceptance criteria.**

- [ ] No HTTP requests to the destination while the circuit is open.
- [ ] Open-circuit deferrals do not push deliveries to `DEAD`.
- [ ] Recovery closes the circuit and drains queued deliveries.

### B5. Rate limiting per destination

Labels: `enhancement`, `ops`. Roadmap: [5](../ROADMAP.md#5-rate-limiting-per-destination)

**Problem.** Replays and provider backlogs can overwhelm small servers.

**Scope.** `maxPerSecond` and burst per destination, enforced across workers via Redis.

**Acceptance criteria.**

- [ ] A burst of 50 at 5/s takes at least 9 s at the stub.
- [ ] Throttling does not consume attempts.

### B6. Multi-user auth (GitHub OAuth) and teams

Labels: `enhancement`, `security`. Roadmap: [6](../ROADMAP.md#6-multi-user-auth-github-oauth-and-teams)

**Problem.** One shared admin password; no per-person access or audit trail.

**Scope.** GitHub OAuth, users, teams, roles (viewer, member, admin), server-side sessions, audit
log. Resolves A2.

**Acceptance criteria.**

- [ ] Users see only their teams' endpoints (404 otherwise).
- [ ] Viewers get 403 on replay and edits.
- [ ] Revoked sessions stop working on the next request.
- [ ] Replays and config changes are in the audit log.

### B7. Outgoing request signing

Labels: `enhancement`, `security`. Roadmap: [7](../ROADMAP.md#7-outgoing-request-signing)

**Problem.** Destinations cannot verify that a request came from Hookline.

**Scope.** Per-destination secret, `X-Hookline-Signature: t=…,v1=…`, verification helper,
rotation with two active secrets.

**Acceptance criteria.**

- [ ] The E2E stub verifies the signature with the published helper.
- [ ] Old and new secrets are both accepted during rotation.

### B8. Prometheus metrics and OpenTelemetry traces

Labels: `enhancement`, `ops`. Roadmap: [8](../ROADMAP.md#8-prometheus-metrics-and-opentelemetry-tracing)

**Problem.** No time series for ingest rate, latency, retries or outbox lag.

**Scope.** `/metrics` on API and dispatcher; one OTel trace per delivery across ingest, relay,
queue wait and attempts; both off by default.

**Acceptance criteria.**

- [ ] Documented metric names and labels.
- [ ] A delivery with one retry yields one trace with ingest, relay and two attempt spans.
- [ ] No measurable overhead when disabled.

### B9. Payload search

Labels: `enhancement`. Roadmap: [9](../ROADMAP.md#9-payload-search)

**Problem.** Finding a specific webhook means scrolling.

**Scope.** Postgres full-text index on UTF-8 bodies, capped per row; search box combined with
filters and pagination.

**Acceptance criteria.**

- [ ] A value in a JSON body is found on the first page of results.
- [ ] Binary and oversized bodies are skipped without failing ingest.
- [ ] Ingest p95 regresses by no more than 10 % (B13 load test).

### B10. Export a request as cURL or a test fixture

Labels: `enhancement`, `dx`. Roadmap: [10](../ROADMAP.md#10-export-a-request-as-curl-or-a-test-fixture)

**Problem.** Reproducing a real webhook in a terminal or a test is manual work.

**Scope.** "Copy as cURL", JSON fixture and `.http` file downloads in the inspector.

**Acceptance criteria.**

- [ ] The cURL command reproduces body bytes and content type for JSON and binary bodies (test).
- [ ] Redacted values never appear in exports.

### B11. Shopify, Slack and Twilio signature formats

Labels: `enhancement`. Roadmap: [11](../ROADMAP.md#11-more-signature-formats)

**Problem.** Only generic SHA-256, GitHub and Stripe are verified.

**Scope.** Add the three schemes to `@hookline/signatures`, the enum (migration) and the dashboard.

**Acceptance criteria.**

- [ ] Known-good vectors from each provider's documentation pass.
- [ ] Tamper and timestamp-skew tests (Slack) fail as expected.

### B12. Ordered delivery mode

Labels: `enhancement`. Roadmap: [12](../ROADMAP.md#12-ordered-delivery-mode)

**Problem.** Parallel workers and retries can reorder events for a destination.

**Scope.** Per-endpoint FIFO mode by `receivedAt` with head-of-line blocking.

**Acceptance criteria.**

- [ ] With the first delivery failing twice, later ones wait, and the stub receives all in order.
- [ ] Unordered endpoints are unaffected.

### B13. Load test: 500 req/s ingest, p95 under 50 ms

Labels: `ops`. Roadmap: [13](../ROADMAP.md#13-load-test-500-requestss-ingest-p95-under-50-ms)

**Problem.** Ingest performance is unmeasured.

**Scope.** k6 script, docker-compose stack, results in `docs/LOAD_TEST.md`.

**Acceptance criteria.**

- [ ] p50/p95/p99, error rate and outbox lag are reported with hardware details.
- [ ] p95 under 50 ms at 500 req/s with no errors, or a written analysis and follow-up issues.

### B14. Docker image and deploy guide

Labels: `ops`. Roadmap: [14](../ROADMAP.md#14-docker-image-and-deploy-guide)

**Problem.** Hookline can only be run from source.

**Scope.** Non-root images with health checks, a deploy compose file and guide, image build and
vulnerability scan in CI. Should also resolve A1 (runtime `API_URL`).

**Acceptance criteria.**

- [ ] `docker compose -f docker-compose.deploy.yml up` runs the stack from published images.
- [ ] Images contain no dev dependencies or secrets.
- [ ] The guide works end to end on a clean machine.
