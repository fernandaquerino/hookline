# Hookline roadmap

Phase 1 (the relay, inspector, dashboard and tests) is complete. Everything below is planned and
**not implemented**. Issue-ready versions of these items, plus known Phase 1 limitations, are in
[docs/ISSUES.md](docs/ISSUES.md).

Items are numbered for reference, not priority. Suggested grouping:

| Theme               | Items                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| Local development   | 1 CLI tunnel, 10 export as cURL/fixture                                                 |
| Delivery control    | 2 transformations, 3 filters, 4 circuit breaker, 5 rate limiting, 12 ordered delivery   |
| Security and access | 6 multi-user auth, 7 outgoing signing, 11 more signature formats                        |
| Operations          | 8 metrics and tracing, 9 payload search, 13 load test, 14 Docker image and deploy guide |

---

## 1. CLI tunnel: `hookline listen --forward`

**Problem.** Developers want webhooks delivered to `http://localhost:3000` on their own laptop, but
Hookline usually runs somewhere else and cannot reach a private machine (and the SSRF guard rightly
blocks private addresses in shared environments).

**Scope.**

- A `hookline` CLI package with `hookline login` and
  `hookline listen --endpoint <id> --forward http://localhost:3000/webhooks`.
- The CLI opens an authenticated WebSocket to the API; a new destination type `tunnel` routes
  deliveries over that socket instead of HTTP.
- The CLI performs the local HTTP request and returns status, headers and a body snippet, which are
  recorded as a normal `DeliveryAttempt`.
- No tunnel connected counts as a retryable failure, so deliveries wait for the developer.

**Acceptance criteria.**

- With the CLI connected, a webhook sent to the ingest URL reaches the local server, and the attempt
  appears in the inspector with the local response status.
- With the CLI disconnected, deliveries go to `FAILED_RETRYING` and succeed after it reconnects.
- The tunnel needs a valid token; a revoked token closes the socket.
- E2E test runs the CLI against a local stub server.

## 2. Payload transformations per destination

**Problem.** Destinations sometimes expect a different shape than the provider sends (for example,
a Slack-compatible message from a GitHub event).

**Scope.**

- Optional transformation on a destination: a JSONata expression (first) or a sandboxed JS function
  (later, if needed) that maps the parsed JSON body to a new body.
- Runs in the dispatcher before sending, with a CPU and memory limit and a timeout.
- Dashboard editor with a "preview against this request" button.

**Acceptance criteria.**

- A destination with a transformation receives the transformed body; others receive the original.
- A transformation error marks the attempt as a final failure with the error message recorded.
- A transformation that loops or exceeds limits is stopped within the configured timeout.
- Preview shows the output for a stored request without creating a delivery.

## 3. Destination filters by header or JSON path

**Problem.** Endpoints often receive many event types, but each destination only cares about some
(for example, only `X-GitHub-Event: push`).

**Scope.**

- Optional filter rules per destination: header equals / matches, JSON path equals / exists, joined
  by all/any.
- Evaluated at ingest, inside the same transaction, so non-matching destinations get no delivery.
- The inspector shows which destinations were skipped by a filter.

**Acceptance criteria.**

- A request that does not match a destination's filter creates no delivery for it, and the
  inspector says so.
- Filters are validated on save (invalid JSON path rejected with `VALIDATION_FAILED`).
- Unit tests cover the rule evaluator; an integration test covers ingest with filters.

## 4. Circuit breaker per destination

**Problem.** A destination that is down keeps receiving retries for every delivery, which wastes
work and can delay its recovery.

**Scope.**

- Track consecutive failures per destination. After a threshold the circuit opens: new attempts
  are deferred (not counted as attempts) until a cool-down passes.
- Half-open: one probe attempt; success closes the circuit, failure reopens it.
- Dashboard shows circuit state and allows a manual reset.

**Acceptance criteria.**

- With the stub destination failing, the circuit opens after N failures and no further HTTP
  requests are made during the cool-down.
- Deferred deliveries are not moved to `DEAD` because of the open circuit.
- After the destination recovers, the probe succeeds and queued deliveries drain.

## 5. Rate limiting per destination

**Problem.** Bursts (a replay of hundreds of dead letters, a provider re-sending a backlog) can
overwhelm a small local or staging server.

**Scope.**

- Optional `maxPerSecond` (and burst) per destination, enforced in the dispatcher across workers,
  using a Redis token bucket or BullMQ's rate limiter with group keys.
- Throttled jobs are delayed, not failed.

**Acceptance criteria.**

- With a limit of 5/s, a burst of 50 deliveries is spread over at least 9 seconds, measured at the
  stub server.
- Throttling does not consume attempts or change `nextAttemptAt` semantics for retries.

## 6. Multi-user auth (GitHub OAuth) and teams

**Problem.** Phase 1 has a single shared admin password, so there is no per-person access or audit.

**Scope.**

- GitHub OAuth sign-in; `User`, `Team` and `Membership` models; endpoints owned by a team.
- Roles: viewer (inspect), member (replay, edit destinations), admin (manage endpoints and team).
- Session storage server-side so sessions can be revoked; audit log for replays and config changes.
- Keep the admin password as an optional bootstrap/fallback for single-user installs.

**Acceptance criteria.**

- A user only sees endpoints of their teams; API returns 404 for others.
- Viewers cannot replay or edit (403 with a stable code).
- Revoking a session logs the user out on the next request.
- Replays and config changes appear in the audit log with the acting user.

## 7. Outgoing request signing

**Problem.** Destinations cannot tell that a request really came from Hookline.

**Scope.**

- Per-destination signing secret (encrypted at rest like endpoint secrets).
- Add `X-Hookline-Signature: t=<unix>,v1=<hmac-sha256 of "t.body">` and document verification, with
  a helper in `@hookline/signatures`.
- Secret rotation with two active secrets.

**Acceptance criteria.**

- The stub server verifies the signature in E2E using the published helper.
- Rotating the secret keeps both old and new valid during the overlap window.
- Signature uses the exact bytes sent (after any transformation).

## 8. Prometheus metrics and OpenTelemetry tracing

**Problem.** Operators cannot see ingest rate, delivery latency, retry volume or outbox lag over
time; `/health` is a snapshot.

**Scope.**

- `/metrics` on API and dispatcher (prom-client): ingest count by status code, ingest latency
  histogram, attempts by outcome, delivery latency, outbox lag, queue depth.
- OpenTelemetry: one trace per delivery spanning ingest, outbox relay, queue wait and each attempt;
  OTLP exporter configured by env.

**Acceptance criteria.**

- Metrics endpoint exposes the listed series with stable names, documented in the README.
- A delivery with one retry produces one trace with ingest, relay and two attempt spans.
- Metrics and tracing are off by default and cost nothing when disabled.

## 9. Payload search

**Problem.** Finding "the webhook for order 1234" means scrolling the live tail.

**Scope.**

- Full-text search on bodies (and selected headers) using Postgres `tsvector` on a text column
  derived from UTF-8 bodies only, capped per row (for example the first 64 KB) to bound index size.
- Search box on the endpoint page; combines with existing filters and cursor pagination.

**Acceptance criteria.**

- Searching for a value present in a JSON body returns that request within one page.
- Binary and oversized bodies are skipped from indexing without failing ingest.
- Ingest p95 latency does not regress by more than 10 % (measured with item 13's load test).

## 10. Export a request as cURL or a test fixture

**Problem.** Developers want to reproduce a real webhook in their own tests or terminal.

**Scope.**

- "Copy as cURL" in the inspector (method, URL placeholder, end-to-end headers, body; redacted
  headers left out with a comment).
- "Download fixture" as JSON (`{ method, headers, body, bodyEncoding }`) and as a raw `.http` file.

**Acceptance criteria.**

- The generated cURL command, run against a destination, reproduces the same body bytes and
  content type (verified in a test with a binary and a JSON body).
- Redacted values never appear in exports.

## 11. More signature formats

**Problem.** Phase 1 verifies generic SHA-256, GitHub and Stripe only.

**Scope.**

- Shopify (`X-Shopify-Hmac-Sha256`, base64 HMAC of the body).
- Slack (`X-Slack-Signature: v0=...` over `v0:{timestamp}:{body}`, with timestamp tolerance).
- Twilio (`X-Twilio-Signature`, HMAC-SHA1 over URL plus sorted form params; needs the public URL).

**Acceptance criteria.**

- Each scheme has known-good vectors from the provider's documentation, plus tamper and
  timestamp-skew tests, in `@hookline/signatures`.
- The schemes are selectable in the dashboard and stored in the `SigningScheme` enum via a migration.

## 12. Ordered delivery mode

**Problem.** Some consumers require events in the order received; parallel workers and retries can
reorder them.

**Scope.**

- Per-endpoint `ordered` flag: deliveries to a destination are processed strictly FIFO by
  `receivedAt`; a failing head-of-line delivery blocks later ones until it succeeds or goes `DEAD`.
- Implemented with BullMQ groups or a per-destination lock.

**Acceptance criteria.**

- With the stub failing the first delivery twice, later deliveries are not attempted until it
  succeeds, and the stub receives them in received order.
- Unordered endpoints keep current parallel behaviour.

## 13. Load test: 500 requests/s ingest, p95 under 50 ms

**Problem.** Ingest performance is unmeasured.

**Scope.**

- k6 (or autocannon) script for a 1 KB JSON payload at 500 req/s for 5 minutes against a
  docker-compose stack, with dispatcher running and a fast stub destination.
- Document hardware, configuration, results and bottlenecks in `docs/LOAD_TEST.md`.

**Acceptance criteria.**

- Results include p50/p95/p99 ingest latency, error rate and outbox lag over time.
- p95 under 50 ms at 500 req/s with zero errors on the documented hardware, or a written analysis of
  what prevents it and the follow-up issues.

## 14. Docker image and deploy guide

**Problem.** Running Hookline means building from source.

**Scope.**

- Multi-stage Dockerfiles (or one image with three entrypoints) for API, dispatcher and dashboard,
  running as non-root, with health checks.
- A production-style `docker-compose.deploy.yml` and a deploy guide covering environment variables,
  migrations, TLS termination, backups, retention and the security defaults
  (`ALLOW_PRIVATE_DESTINATIONS=false`).
- CI builds the images and runs the E2E suite against them.

**Acceptance criteria.**

- `docker compose -f docker-compose.deploy.yml up` starts a working stack from published images.
- Images contain no dev dependencies or secrets; a vulnerability scan runs in CI.
- The guide is followed end to end on a clean machine by someone other than the author.
