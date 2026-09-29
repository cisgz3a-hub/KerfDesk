## ADR-523 Amendment 3 - Licensing service operations: record refused payments, end failed checkouts, limit per route, log, audit, rekey and delete (2026-09-29)

**Status:** Implemented in source; takes effect only when the owner redeploys the Worker | **Date:** 2026-09-29 | **Amends:** ADR-523 (licensing trust, payments and updates)

### Context

The licensing Worker is deployed at `license.kerfdesk.com` with licensing and
payments switched off. A review found eight gaps that would reach buyers or
support once it is switched on:

1. A verified Paddle payment the service refused (a discount, a quantity other
   than one, mismatched totals, an unknown or already-paid order, a renewal for a
   revoked licence) answered 409 and left no record. Paddle retried it forever, and
   the buyer, already charged, saw "payment pending" forever. A completed
   transaction made by hand in Paddle, or for another product, was refused the
   same way.
2. When Paddle refused to create a transaction, or answered without a checkout
   link, the order stayed pending, and the same checkout request answered
   `checkout_pending` forever.
3. One rate limit, keyed by the raw address, covered every route: trial starts
   were as loose as everything else, Paddle's webhooks competed with customers,
   and each address in an IPv6 /64 had its own budget.
4. Nothing was logged, and there was no way to check that the service was up.
5. One static administrator token guarded every admin route, and nothing recorded
   what it did.
6. A leaked licence key could not be replaced, only revoked.
7. There was no backup export of the records.
8. There was no way to delete one customer's records on request, which the draft
   privacy notice promises.

### Decision

1. **Refused payments are recorded and acknowledged.** A signed completed
   transaction without a KerfDesk order number is answered 200 and ignored. For a
   KerfDesk order, a refusal (`payment_not_completed`, `payment_mismatch`,
   `unknown_order`, `order_already_paid`, `license_already_exists`,
   `renewal_requires_paid_license`, `provider_order_reused`, `payment_reused`) is
   written as `payment-rejected:paddle:<transaction>`. The record holds the order
   number, event ID, code, the amounts Paddle reported and the time. The webhook
   answers 200, so Paddle stops retrying.
   - Only the order's own payment marks it. The payment must carry the order's
     proof, and no other transaction may be bound to the order. The order then
     becomes `rejected`, and its claim answers the new code `payment_rejected`
     (409). The app then tells the buyer not to pay again and to email support
     with the order number.
   - A payment that only names an order never marks it, and a fulfilled order
     keeps its licence.
   - A redelivery records nothing new but is checked again, so after support
     fixes the cause (a revoked licence restored, say), redelivering from Paddle
     fulfils the order.
   - Other failures, such as a malformed event, an outage or a reused event ID,
     still answer an error so that Paddle retries.
   - The admin lookup finds the rejection by order number or by Paddle
     transaction ID.
   - The checkout page opens the transaction with Paddle's discount field hidden.
     The launch checklist sets both Paddle prices to quantity minimum 1 and
     maximum 1.
2. **A checkout nobody can pay ends.** Some answers mean no payable checkout
   exists:
   - A definite refusal from Paddle (a 4xx other than 408, 409 and 429) answers
     the new code `checkout_failed` (502). Paddle's status and error code are kept
     on the order.
   - An answer the service will not hand out (unreadable, the wrong catalogue, or
     a missing or unapproved link) answers `invalid_provider_response` (503). A
     wrong catalogue at checkout used to answer `payment_mismatch`.

   In either case nobody holds a link to pay, so one transaction marks the order
   `failed` and frees its checkout request ID. The same request ID then starts a
   fresh order. Timeouts, network errors, 5xx answers and 408, 409 or 429 stay
   `checkout_pending`, because the transaction may exist.
3. **Each route has its own rate limit.** Trial starts get 5 a minute
   (`TRIAL_RATE_LIMITER`, namespace `1003`) and Paddle webhooks 600 a minute
   (`WEBHOOK_RATE_LIMITER`, `1002`). Every other route keeps 30 a minute
   (`REQUEST_RATE_LIMITER`, `1001`, unchanged). An IPv4 address is its own key.
   An IPv6 address is keyed by its /64, and an IPv4-mapped IPv6 address counts as
   the IPv4 address. A missing limiter binding fails closed.
4. **Every request is logged, and the service has a health route.**
   - The Worker writes one structured line per request: the method, the route (a
     fixed path, or `other`), the status, the error code, a webhook's outcome and
     the time taken. For an unexpected failure it adds the error's type, never its
     message. The Durable Object passes that type in an internal header, which the
     Worker removes before answering.
   - The log never holds bodies, keys, tokens, licence or order IDs, email
     addresses or IP addresses.
   - Workers Logs stays off in `wrangler.jsonc`, so the lines are not stored.
     Turning it on is the owner's decision. The privacy notice must then say that
     request logs are kept and for how long.
   - `GET /v1/public/health` makes one Durable Object round trip with one
     database read. It answers 200 `{ok:true}`, or 503 `{ok:false}`. Like the
     public configuration, it skips the rate limit and answers while licensing is
     switched off. Each Worker isolate reuses its last answer for ten seconds, so a
     client polling it in a loop cannot queue ahead of licence calls in the one
     Durable Object (added after the pre-merge re-audit, before any deploy).
5. **Administration is audited, and its token can rotate.**
   - Every admin change writes `audit:<time>:<sequence>` in its own transaction:
     the route, the target, the outcome, which token was used and the time. The
     record holds no keys, tokens or request bodies.
   - A call refused after sign-in is recorded too, as a best effort.
   - A lookup that returns a licence key is recorded as `key-disclosed`. If its
     record cannot be written, it discloses nothing.
   - An optional `ADMIN_TOKEN_NEXT` is accepted alongside `ADMIN_TOKEN`, so the
     token can be rotated without downtime. Both are compared in constant time on
     every call.
6. **A leaked key can be replaced.** Licences gain a `keyVersion`, and a missing
   version means 0. A version 0 key is derived from the licence ID as before, so
   every existing key stays valid until its licence is rekeyed. A later version is
   derived from `<licence ID>:<version>`.
   - `POST /v1/admin/licenses/rekey` moves the licence to its next version and
     stores the new key's hash. The old key stops activating at once, and the new
     key is returned.
   - `releaseSeats` also frees every seat without counting toward the six-moves
     cap.
   - A rekey that loses a race answers `idempotency_conflict`.
   - Claim and lookup use the stored version.
7. **Records can be exported, and one customer's records deleted.**
   - `POST /v1/admin/export` returns every record as paged JSON Lines. The store
     keeps only HMACs of keys, tokens and device identifiers, so the export
     contains none of them.
   - `POST /v1/admin/customers/delete` takes a licence ID or an order number. In
     one transaction it deletes the licence, its seats, its grant and its orders,
     with each order's checkout and payment records. A paid or developer licence
     must be revoked first (`license_not_revoked`). Audit records stay.
   - Scheduled purges are not built. They need a cron trigger, which is the
     owner's decision.

### Consequences

- Nothing changes live until the owner redeploys the Worker from their PC. Before
  that, check that rate-limit namespace IDs `1002` and `1003` are unused in the
  account. The `LicenseAuthority` class, its `v1` migration and
  `REQUEST_RATE_LIMITER` with `1001` are unchanged, so the redeploy needs no
  migration. `LICENSING_ENABLED` and `PAYMENTS_ENABLED` stay `"false"`.
- The desktop app needs messages for `payment_rejected` (409) and
  `checkout_failed` (502). After `checkout_failed` or `invalid_provider_response`,
  a retry with the same checkout request ID creates a new order and a new Paddle
  transaction.
- A lookup by order number now answers every order with its status. It used to
  answer `payment_pending` for any order not yet fulfilled.
- Deleting a trial lets that Windows installation start a new trial.
- Existing records need no migration. The store gains `payment-rejected:`,
  `audit:` and `audit-sequence` records, and orders gain the `failed` and
  `rejected` states.
- `desktop-commercial-support.md` gains procedures for refused payments, failed
  checkouts, rekeying, audit, token rotation, deletion requests and the health
  route. `desktop-commercial-launch.md` gains the Paddle quantity step and an
  uptime monitor.
- Still open: restoring from an export, point-in-time recovery, and scheduled
  purges of deactivated devices and old trial records.
