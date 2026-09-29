# Desktop licensing service

This is an implemented, locally tested Cloudflare Worker and SQLite Durable Object service. It has **not been deployed**. Licensing and payments default to disabled. No merchant account, Paddle products, customer licences, developer grants, or paid Cloudflare resources were created by this implementation.

The approved commercial model is a 30-day full-feature trial, USD 49.50 perpetual desktop licence with three active computers and one year of eligible updates, and an optional USD 20 further year of updates. Existing eligible versions keep working when update entitlement ends. Johann and Father each receive a separately issued developer licence with three active computers and unlimited future update eligibility. The two developer grants require the private administration API; their names are not activation codes.

The Paddle catalog must use one-time prices, USD, external tax, no recurring billing, no trial period, and no discount. The amounts above are before any tax Paddle adds at checkout. No payment provider request is made while `PAYMENTS_ENABLED` is false or required configuration is missing. Sandbox testing and live selling require separate Paddle credentials, databases, signing keys, and pinned client trust keys.

## Architecture and guarantees

`worker.mjs` applies an edge rate-limit binding and forwards requests to one named `LicenseAuthority` Durable Object. `storage.mjs` uses real SQLite, indexed record keys, parameter bindings, and synchronous transactions. This deliberately keeps seat allocation, order fulfilment, and event/payment deduplication in one atomic authority. It is suitable for an initial service; do not silently split these records into eventually consistent stores when scaling.

The server stores HMACs of licence credentials, activation credentials, device digests, checkout request IDs, and order claim credentials. It does not store raw hardware identifiers, licence keys, activation tokens, admin credentials, or customer payment card information. Non-secret licence/activation/order/provider IDs, device display names, developer display names, and entitlement dates are stored. The signing key is a Worker secret, never a database record. No application code logs requests, exception text, signatures, credentials, fingerprints, payment bodies, or tokens. Worker observability is disabled in the supplied configuration; keep provider request/body logging redacted if operational logging is later enabled.

Every allocation re-reads the licence and its active seats inside one transaction. Concurrent requests cannot exceed three active seats. Repeating activation of the same device returns the same activation ID/token. Deactivation removes only that activation ID, and repeating an old deactivation cannot remove a later reactivation or count again. Re-activation gets a fresh activation ID and token. A licence key can list and remotely deactivate its own installations. A paid licence can free at most six seats in any rolling 30 days, from its devices or with its key; the seventh answers `release_limit_reached` and the seat stays active. Developer and trial licences are not capped (ADR-523 Amendment 1).

Trials start from the server clock and retain their original expiry through app/server restarts and deactivation. The main process supplies a stable, product-scoped SHA-256 digest of the OS installation identity. Reinstalling the OS, spoofing identity, or modifying the client can defeat that identity policy; this service does not claim hardware attestation or perfect piracy prevention. The client must also reject clock rollback when verifying an offline trial.

Perpetual offline use and instantaneous remote revocation are incompatible. Deactivation deletes the local entitlement/credential and immediately prevents future server refresh for that activation. An administrator can revoke a licence; its devices lose their credential at their next online refresh, which the app runs about once a week, and a revoked key can no longer activate. An intentionally retained, valid offline perpetual token cannot be recalled remotely. The three-device limit is enforced on active server seats, with ordinary client transfers; it is not a claim that a maliciously modified offline client can be disabled. Back up the authority and secrets together. Restoring an old database can resurrect old seat state and requires operator reconciliation.

This service performs no machine, motion, Frame, Start, hardware, or output policy checks.

## Desktop API contract

Use HTTPS and JSON. Requests must have no query string or `Origin` header; desktop requests originate in the main process. Public checkout configuration is the sole browser-readable route. Credentials belong in JSON bodies or the admin Authorization header, never URLs. Ordinary bodies are limited to 16 KiB, payment webhooks to 128 KiB. The included edge limit is 30 requests per IP per 60 seconds; this is abuse protection, not the atomic seat authority. Tune with real traffic and webhook volumes before launch.

| Method/path | Request | Successful response |
| --- | --- | --- |
| `POST /v1/trials/start` | `deviceId`, `deviceName` | `entitlement`, `activationToken` |
| `POST /v1/licenses/activate` | `licenseKey`, `deviceId`, `deviceName` | `entitlement`, `activationToken` |
| `POST /v1/activations/refresh` | activation credentials below | `entitlement`, same `activationToken` |
| `POST /v1/activations/deactivate` | activation credentials below | `{ "deactivated": true }` |
| `POST /v1/licenses/activations` | `licenseKey` | `{ "activations": [{ "activationId", "deviceName", "createdAt" }] }` |
| `POST /v1/licenses/deactivate` | `licenseKey`, `activationId` | `{ "deactivated": true }` |
| `POST /v1/checkout` | `requestId`, `operation: "purchase" | "renewal"`; renewal additionally requires activation credentials or `licenseKey` | `orderId`, `claimToken`, `checkoutUrl`, `amount`, `currency` |
| `POST /v1/orders/claim` | `orderId`, `claimToken` | `licenseId`, `licenseKey`, only after verified payment |
| `GET /v1/public/config` | none | `enabled`, `provider`, `environment`, `clientToken`, `purchase`, `renewal` |

Activation credentials are `{ licenseId, activationId, deviceId, activationToken }`. `deviceId`, `activationToken`, `claimToken`, and checkout `requestId` are 43-character base64url values representing 32 bytes. The main process generates and securely persists the checkout request ID **before** sending a request, then persists returned order credentials **before** opening the browser. Server IDs are UUIDs, except trial licence IDs are `trial-` followed by a server HMAC. Licence keys have the form `KD1.<licence UUID>.<43-character secret>`.

Errors are `{ "error": { "code": "..." } }`. Relevant codes include `invalid_credentials` (401), `trial_expired`, `activation_inactive`, `license_revoked` or `license_inactive` (403), `license_not_found` or `order_not_found` (404), `device_limit_reached`, `payment_pending`, `checkout_pending`, or `idempotency_conflict` (409), `rate_limited` or `release_limit_reached` (429), and `service_unavailable` or `payment_provider_not_configured` (503). Only `activation_inactive` and `license_revoked` make the app remove saved rights. The app must not interpret a failure as a successful purchase or erase an otherwise valid offline entitlement.

The browser can read only public Paddle configuration and checkout prices. When disabled it receives `enabled:false` and `provider`, `environment`, `clientToken` set to null. When configured, `purchase` is `{amount:4950,currency:"USD"}` and `renewal` is `{amount:2000,currency:"USD"}`. CORS is limited to the origin of the configured approved payment page. No licence, activation, claim, or admin credentials are exposed to the browser.

### Signed entitlement

Envelope: `{ keyId, payload, signature }`. `payload` is base64url of the exact UTF-8 JSON bytes; `signature` is an Ed25519 signature of those decoded bytes. Do not re-serialize JSON before verification. `keyId` selects an immutable client-pinned public key, never an arbitrary key fetched alongside a token.

```json
{
  "schemaVersion": 1,
  "product": "kerfdesk-desktop",
  "licenseId": "server-id",
  "activationId": "server-id",
  "deviceId": "43-character-device-digest",
  "tier": "trial",
  "issuedAt": 1800000000,
  "accessExpiresAt": 1802592000,
  "updatesUntil": 1802592000,
  "perpetualUpdates": false,
  "maxDevices": 3
}
```

All dates are integer Unix seconds. Trial `updatesUntil` equals `accessExpiresAt`, exactly 30 days after first server registration. Paid `accessExpiresAt` is null, `perpetualUpdates` is false, and `updatesUntil` is the paid update cutoff. On refresh, a paid cutoff may be earlier than `issuedAt`; that does not revoke use of eligible versions. Developer `accessExpiresAt` and `updatesUntil` are null and `perpetualUpdates` is true. The client must validate the entire claim schema, product, pinned signature, device binding, applicable dates, and trusted release eligibility. Renewals extend from the later of the current cutoff or server time by one calendar year (29 February is clamped to 28 February).

### Private administration

`POST /v1/admin/developer-grants`, with `Authorization: Bearer <ADMIN_TOKEN>`, accepts `{grantId,displayName}`. Planned grants are `{grantId:"johann",displayName:"Johann"}` and `{grantId:"father",displayName:"Father"}`. The endpoint returns `{licenseId,licenseKey,displayName}`. Repeating the same grant is idempotent; changing its name under the same ID conflicts. Store the returned keys privately and give each only to its named owner. There is no hardcoded unlock key and no automatic production issuance.

`POST /v1/admin/licenses/status` accepts `{licenseId,status:"revoked"|"active"}` for a paid or developer licence and returns `{licenseId,status}`. Revoke after a refund, a chargeback or a leaked key; restoring re-enables refresh and activation. Trials cannot be revoked this way.

`POST /v1/admin/licenses/lookup` accepts `{licenseId}` or `{orderId}` (a fulfilled order) and returns `{licenseId,licenseKey,tier,status,updatesUntil,activeDevices}`, so support can resend a lost key. Send the key only to the purchaser, privately.

`POST /v1/admin/orders` records an operator-reconciled provider order using `{orderId,provider,providerOrderId,operation,licenseId?}`. It returns order claim credentials but does not grant a licence. Normal checkout uses `/v1/checkout`; the admin route is for a trusted operator and requires the same private credential. Do not ship administration credentials, the signing private key, or an issuance tool in the desktop package or public website.

## Paddle checkout and fulfilment

The service first durably records a checkout intent, request-id HMAC, fixed price, claim-token HMAC, and an order proof. It then creates a Paddle Billing transaction server-side. Only configured price IDs, one item, USD, automatic collection, and the approved `https://kerfdesk.com/buy.html` page are sent. The response must match the fixed one-time catalog and exact checkout origin/path with a single `_ptxn` transaction parameter. No licence credentials or claim tokens go in that URL. The website must be approved in Paddle and load Paddle.js with the public client token.

An ambiguous provider response remains `checkout_pending`. Retrying the same request ID never blindly creates another transaction. If a completed webhook later arrives, its authenticated order proof lets the service reconcile the durable intent and recover the original claim result. An unpaid creation whose response was lost requires operator reconciliation against Paddle before abandoning/recreating it. This is deliberate because no unverified provider idempotency header is assumed. Do not tell a customer to pay a second time to resolve an uncertain result.

`POST /v1/payments/webhook` authenticates `Paddle-Signature` over the exact raw body using HMAC-SHA256 and a five-second past/future timestamp window. Multiple `h1` signatures support provider rotation. Only `transaction.completed` events grant access; signed unrelated events are acknowledged and ignored. Completed events must match a server-created order, its proof, configured price ID, USD base amount (4950/2000), quantity one, no recurring billing, no discount, and consistent subtotal/tax/total. Paddle-added tax is allowed. Browser redirects never fulfil an order.

Event IDs and transaction/payment IDs are recorded durably with the licence mutation in one transaction. Duplicate or concurrent deliveries cannot issue multiple licences or add renewal years repeatedly. A changed event ID cannot charge the same order twice, and the same payment cannot fulfil another order. An injected storage failure rolls back both the entitlement and deduplication records so retry is safe. The service does not store webhook payment/customer bodies.

Merchant approval, actual catalog creation, sandbox end-to-end payment qualification, refunds/chargebacks and support reconciliation procedures, terms/privacy review, and production credentials remain launch work. Refund events do not automatically revoke offline perpetual tokens; the business must establish and document the support policy before accepting money.

## Configuration and verification

The supplied `wrangler.jsonc` has no account ID, routes, merchant tokens, live credentials, or secrets. `workers_dev` and preview URLs are off. Confirm the correct Cloudflare account before provisioning. Do not deploy to whichever OAuth account happens to be logged in.

Private Worker secrets:

- `SIGNING_PRIVATE_JWK`: JSON string for an Ed25519 private JWK, `{kty:"OKP",crv:"Ed25519",x:"base64url",d:"base64url"}`. A Node-generated optional `alg` field is accepted; the implementation imports explicitly checked Ed25519 key material for compatibility with workerd.
- `HASH_SECRET` and `DERIVATION_SECRET`: separate, independently generated 32-byte base64url secrets. Back up both; changing them without migration invalidates credential lookup/derivation.
- `ADMIN_TOKEN`: separate random 32-byte base64url private administration credential.
- `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`: actual credentials for the chosen environment after approval/testing. The webhook secret is used as its raw string, not base64-decoded.

Non-secret configuration: `SIGNING_KEY_ID`, `LICENSING_ENABLED`, `PAYMENTS_ENABLED`, `PAYMENT_PROVIDER=paddle`, `PADDLE_ENVIRONMENT=sandbox|live`, `PADDLE_PURCHASE_PRICE_ID`, `PADDLE_RENEWAL_PRICE_ID`, `PADDLE_CHECKOUT_URL`, `PADDLE_CLIENT_TOKEN`. Public client tokens must use the environment's `test_`/`live_` prefix. The rate-limit namespace ID must be checked for collision with existing account bindings. Pin only the corresponding public verification key in the desktop build. Rotate keys with overlapping client trust and a documented recovery procedure.

From repository root:

```text
node --test services/desktop-licensing/*.test.mjs
pnpm exec eslint services/desktop-licensing/*.mjs
pnpm exec prettier --check services/desktop-licensing/*.mjs services/desktop-licensing/wrangler.jsonc
pnpm exec wrangler deploy --dry-run --config services/desktop-licensing/wrangler.jsonc
```

The integration test runs the repository's installed Miniflare/workerd with real SQLite and synthetic keys, disables Cloudflare metadata fetching, and makes no merchant requests. Its compatibility date is the pinned local runtime's 2026-06-11 support date. The deployment configuration uses 2026-09-28; a current staging runtime and actual merchant sandbox still need qualification before production. All other payment tests use injected provider responses and real cryptography/SQLite. A passing test or dry-run is not a deployed service or a successful payment.

## Primary sources checked 28 September 2026

- [Cloudflare storage recommendation](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) (page updated 3 July 2026): use persistent storage and SQLite-backed Durable Objects for new namespaces. [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) documents synchronous transactional rollback used here.
- [Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) (updated 23 April 2026) documents Ed25519 and HMAC sign/verify support. The implementation uses native Web Crypto rather than a custom signature algorithm.
- [Cloudflare Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) (updated 25 August 2026): SQLite-backed Durable Objects are available on Workers Free. Documented free allowances include 100,000 requests/day, 13,000 GB-seconds/day, 5 million rows read/day, 100,000 written/day and 5 GB storage. Exceeding free limits fails operations. Paid-plan costs and other Worker usage are separate; this is not a promise that an arbitrary workload costs zero.
- [Cloudflare rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) describes the edge abuse control. Licence seats remain transactional independently of this limiter.
- [Paddle webhook verification](https://developer.paddle.com/webhooks/about/signature-verification/) documents raw-body HMAC, timestamp checking and possible multiple signatures. [Completed transactions](https://developer.paddle.com/webhooks/transactions/transaction-completed/) provide the paid/processed event and catalog/totals evidence used for fulfilment.
- [Paddle create transaction](https://developer.paddle.com/api-reference/transactions/create-transaction/) defines server-side items, custom data, automatic collection and returned checkout links. [Default payment link](https://developer.paddle.com/build/transactions/default-payment-link/) requires an approved page with Paddle.js and describes the `_ptxn` parameter. These are current online documentation, not evidence of a configured merchant account.
