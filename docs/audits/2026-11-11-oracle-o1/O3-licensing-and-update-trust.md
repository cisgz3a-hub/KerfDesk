# O3 — licensing-and-update-trust (Oracle audit O1, batch 1)

**Area:** `services/desktop-licensing/` (Worker: Paddle checkout, webhooks, adjustments and refunds, credential races, rate limit, crypto, storage, admin), `electron/licensing-*`, `electron/desktop-licensing.ts`, `electron/auto-update.ts`, `electron/commercial-update*.ts`, `electron/update-channel-trust.ts`, `electron/desktop-manual-updates.ts` and the `manual-update*` modules it uses.
**Code read:** `origin/main` 5c9441ba8 (2026-11-11). **Method:** [AREAS.md](AREAS.md) steps 1–8. **Policy:** the gates themselves (ADR-540, ADR-592, ADR-623 incl. Amd 2 and Amd 3) are the maintainer's; this audit checks defects against them and against outside oracles only.

## Headline

**No P1 and no P2.** A paying user cannot lose Pro to clock skew, rollback or time offline. A definitive refusal is the only thing that removes saved rights. The Paddle webhook path matches Paddle's signature, retry and ordering model. Updates cannot be downgraded, replayed or served unsigned on either lane.

**Seven P3s were confirmed** (one refuted):

- **Fixed:** four, in two pull requests.
- **Listed for the maintainer:** three, each latent or tied to an ADR choice.

The auditor's one P2, a failed re-encryption hiding a paid licence, was downgraded to P3. It cannot happen on Windows today and was already filed as rolling v2 P3-9. It is fixed anyway.

| | Count |
|---|---|
| Raised (two auditors) | 8 |
| Refuted | 1 |
| P1 / P2 | 0 / 0 |
| P3 confirmed | 7 (4 fixed: #1772, #1774; 3 listed) |
| Oracle claims CONTRADICTED by research (plan corrected, no code finding) | 4 |

## Oracle plan (written before reading the code closely)

| # | Claim | Oracle |
|---|---|---|
| A1 | Webhooks are authenticated with `Paddle-Signature` `ts=…;h1=…`: HMAC-SHA256 over `ts:rawBody`, a constant-time compare, a timestamp tolerance, and possibly several `h1` values during secret rotation | Paddle, [signature verification](https://developer.paddle.com/webhooks/signature-verification) |
| A2 | Delivery is at least once and unordered. Order by `occurred_at`, dedupe by `event_id`, and answer 200 within five seconds; any other answer is retried | Paddle, [how webhooks work](https://developer.paddle.com/webhooks/about/how-webhooks-work), [respond to webhooks](https://developer.paddle.com/webhooks/respond-to-webhooks), [replay](https://developer.paddle.com/api-reference/notifications/replay-notification) |
| A3 | `custom_data` can be set by the browser, so it is untrusted. `transaction.paid` comes before `transaction.completed` | Paddle, [custom data](https://developer.paddle.com/build/transactions/custom-data), [transaction.paid](https://developer.paddle.com/webhooks/transactions/transaction-paid) |
| A4 | Adjustment model: actions, statuses (`pending_approval`, `approved`, `rejected`, `reversed`), full and partial types, item types, and how a reversal is represented | Paddle, [adjustments overview](https://developer.paddle.com/api-reference/adjustments/overview), [create adjustment](https://developer.paddle.com/api-reference/adjustments/create-adjustment) |
| A5 | Catalogue rotation: an archived price cannot be used for new transactions | Paddle, [update price](https://developer.paddle.com/api-reference/prices/update-price) |
| B1 | A Durable Object with SQLite storage is single-threaded with input and output gates, and `transactionSync` is atomic | Cloudflare, [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) |
| B2 | The Rate Limiting binding is approximate and per location, so it is not a security boundary | Cloudflare, [rate limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) |
| B3 | Ed25519 signatures (RFC 8032) and HMAC through WebCrypto | [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032), Cloudflare [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) |
| C1–C3 | electron-updater checks the sha512 from `latest.yml`. It checks the Authenticode publisher only when `publisherName` is present. `allowDowngrade` defaults to false, and setting `channel` turns it on. Failed-install behaviour | electron-updater 6.8.10 source ([AppUpdater.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.10/packages/electron-updater/src/AppUpdater.ts), NsisUpdater), electron-builder [Windows code signing](https://www.electron.build/docs/features/code-signing/code-signing-win/) |
| D | Paid licences never consult the clock and work offline. Trials have a 3-day check-in and 5-minute tolerance. A grant is bound to its device. Only a definitive refusal removes saved rights | ADR-592, ADR-592 Amd 3, ADR-623 Amd 2 |

The money paths were modelled as state machines. Fulfilment covers `pending` → `fulfilled`, `rejected` or `failed`. Adjustments go `pending_approval` → `approved` or `rejected`, then possibly `reversed`, plus `chargeback_reverse`. Each transition was checked against Paddle's event model, including reversed and duplicated delivery.

## Findings

All are P3. Each was reproduced on the real modules. The refuter used a different method: a hand trace of the production call path, a different input or reading, and for O3-P3-4 an inspection of the shipped Electron binary.

### O3-P3-1 — The support lookup never showed the refunds ADR-592 keeps for support review (fixed, #1772)

- **Where:** `services/desktop-licensing/admin.mjs` `lookup`. It read `payment-adjustment:*` records only in delete and export.
- **Oracle:** ADR-592 decision 1 ("partial refunds and renewal adjustments are recorded for support only"). `docs/desktop-commercial-support.md` told support "the lookup shows them".
- **Reproduction:** two approved partial refunds that add up to the whole payment each return `review`, and the licence stays active, as the ADR intends. The lookup by licence, by order and by transaction showed neither of them (auditor repro R2a/R2b; regression test *support finds review refunds in the lookup by licence, order and transaction*).
- **Research:** whether Paddle partials can add up to a full refund is UNSOURCED. The finding does not depend on it; any review refund was invisible.
- **Refuter:** CONFIRMED.
- **Fix:** the lookup returns `paymentAdjustments`, with no customer data. Needs a Worker redeploy.

### O3-P3-2 — A refund arriving while support had revoked the licence by hand left no trace (fixed, #1772)

- **Where:** `payment-adjustments.mjs` `applyPurchaseAdjustments`. It returned `none`, wrote no audit line and kept no review.
- **Oracle:** ADR-592 decision 1. A status support sets by hand replaces the automatic one, so support may restore later. But support then has no way to learn that a refund arrived in between.
- **Reproduction:** support revokes; a full refund arrives (`adjustment: none`); support restores; the refunded licence is active (auditor repro R5).
- **Refuter:** CONFIRMED as a visibility gap, not a policy breach.
- **Fix:** the refund is now recorded as `review` with an audit line. A later same-state update keeps the earlier outcome instead of overwriting it with `none`. Support's decision still stands.

### O3-P3-3 — Every refund or chargeback was logged as a fulfilled payment (fixed, #1772)

- **Where:** `request-log.mjs` `responseDetails`.
- **Oracle:** the service README and ADR-523 Amendment 3 (log outcomes).
- **Reproduction:** auditor repro R3a, through `worker.fetch`.
- **Refuter:** CONFIRMED.
- **Fix:** the log now reads `adjustment-revoked`, `-restored`, `-review`, `-deferred` or `-none`.

### O3-P3-4 — A failed re-encryption made a readable paid licence `unavailable` (fixed, #1774; was rolling v2 P3-9)

- **Where:** `electron/licensing-store.ts` `read()`. When `shouldReEncrypt` was set, the re-save ran inside the read, so a failed save failed the read.
- **Oracle:** ADR-623 Amendment 2 decision 1. Electron `safeStorage.decryptStringAsync` reports `shouldReEncrypt`.
- **Reproduction:** a paid record that read `ready`/`pro` read `unavailable`/`free` once a re-encryption was due and the rewrite threw. The file itself still decrypted.
- **Refuter:** DOWNGRADED from the auditor's P2. Electron 44.5.1 registers only the DPAPI key provider on Windows, so the flag stays false there. It is reachable on Linux and after a future provider change. The licence window is held off (ADR-623 Amd 3), so the effect is paused Pro tools, not a lockout.
- **Fix:** the rewrite is best effort, and the next read retries it.

### O3-P3-5 — A failed **Refresh licence** holds a paid device's covered updates until the weekly check (listed)

- **Where:** `electron/licensing-runtime.ts` `acquire` calls `updateCache.failAuthentication()` on any failed request. `licensing-update-cache.ts` then answers `licence-unconfirmed`.
- **Oracle:** ADR-547 Amendment 1 decision 3 and ADR-561 item 5.
- **Reproduction:** after one failed request, covered updates were still held six days later, and the schedule sent no request.
- **Refuter:** CONFIRMED with narrower triggers. A ready paid user never sees the key form or the trial button, so the real trigger is an explicit Refresh that fails, for example while offline. The hold lasts until the weekly confirmation falls due or KerfDesk restarts, and the on-screen wording stays true.
- **Not fixed:** changing when the hold clears changes ADR-547 Amd 1's documented behaviour. **Maintainer:** let the 30-minute check retry while the hold is set, or set the hold only for the saved credential's own refresh.

### O3-P3-6 — The signed update lane says "up to date" when its check did not finish (listed, latent)

- **Where:** `electron/commercial-update.ts`. Three cases end in `UP_TO_DATE` while a newer signed, covered release exists:
  - `checkForUpdates()` returns `null`;
  - `latest.yml` is behind the signed catalogue;
  - a `publishedAt` lies more than five minutes in the future of a slow local clock.
- **Oracle:** honest failure reporting. `update-status-text.ts` renders "KerfDesk is up to date."
- **Refuter:** CONFIRMED but latent. The signed lane is dormant: shipped builds use `manualUpdates: true` (ADR-547 Amd 1), and `null` occurs only in unpackaged builds.
- **Maintainer:** report a failed or clock outcome before the signed lane goes live.

### O3-P3-7 — A saved order that fails today's validation hides a valid paid credential (listed, latent)

- **Where:** `electron/licensing-store.ts` `parseRecord` rejects the whole record when `payment` fails `validLicencePayment`. The status becomes `invalid-licence` with `storeUnreadable`.
- **Reproduction:** a record whose order checkout URL fails the current rule (auditor repro F-4).
- **Refuter:** CONFIRMED, latent. The checkout URL rule has not changed since before 1.0.0, and `write()` validates first.
- **Not fixed:** dropping only the order would also drop its claim token, which loses a paid-but-unclaimed purchase. **Maintainer:** choose between dropping the order and keeping it aside, before the first release that changes the checkout URL or order format.

## Refuted

- **Worker F4: claiming a `failed` order answers `payment_pending`.** REFUTED. A failed order is always the one the same request just created, and its order ID and claim token are returned only after the order is attached. No client can therefore hold a claim for a failed order; the auditor derived the token inside the test harness.

## Research verdicts that corrected the plan (no code finding)

- **CONTRADICTED: live retries.** Paddle retries for about two days (up to 60 attempts), not three. Sandbox makes 3 attempts in about two minutes. The Worker answers 200 to every event it accepts or ignores, which satisfies Paddle's rule of 200 within five seconds.
- **CONTRADICTED: `transaction.completed`.** It means Paddle's own processing is done, not merchant fulfilment. The Worker fulfils on `completed` with its own order proof, which is consistent.
- **CONTRADICTED: the action list.** Paddle's action list also contains `chargeback_warning_reverse`, which the plan omitted; the code already handles it (`RESTORING`).
- **CONTRADICTED in part: failed installs.** electron-builder's NSIS template uninstalls the old version before extracting the new one, with no rollback (electron-builder 26.17.0 template). This is vendor behaviour that KerfDesk cannot change in place. Both lanes install only on a natural quit, and the signed lane re-checks the downloaded file against the signed manifest first.
- **Not a gap here: unsigned `latest.yml`.** electron-updater 6.8.10 does not sign `latest.yml`, and it skips the Authenticode check when `app-update.yml` has no `publisherName`. KerfDesk covers both:
  - the commercial lane pins the installer's sha512 through an Ed25519-signed manifest and requires an exact `updateInfo` match;
  - `scripts/verify-update-publisher.mjs` and the stable release workflow refuse to ship a package whose `app-update.yml` lacks the signer's `publisherName`.

## Verified clean

Each item has evidence in the auditors' reproduction runs: 21 Worker repro tests plus 62 existing Worker tests, and 13 desktop repro tests plus 136 existing desktop tests. All passed.

- **Webhook signature:**
  - computed over the exact raw body, including non-ASCII;
  - exactly one 10-digit `ts`, with ±5 s tolerance, which equals the Paddle SDK default;
  - 1–4 `h1` values, which supports secret rotation; empty and non-hex `h1` are ignored;
  - compared with `crypto.subtle.verify` (HMAC);
  - stale and replayed deliveries get 401. **Research:** VERIFIED.
- **Forged or mismatched payments:** none fulfil. This covers a wrong or forged order proof (the browser-set `custom_data` is never trusted alone), a wrong price, discount or currency, a subscription, and a dashboard transaction. A rotated catalogue keeps each order's own price snapshot.
- **Status codes:**
  - 200 for accepted and ignored events;
  - 401, 409, 400, 429 or 503 for bad signatures, conflicts, malformed input, rate limits and faults, so Paddle retries;
  - every write runs in one `transactionSync`, and rollback is tested.
  - **Research:** Durable Object atomicity VERIFIED.
- **Delivery order:**
  - Deduplication uses event and payment IDs.
  - An older delivery cannot overwrite newer adjustment state.
  - An approval delivered before its pending creation still revokes.
  - A refund that arrives before completion creates an unclaimable revoked licence.
  - A rejected refund keeps access, and an item-level full refund revokes.
  - Chargeback, reversal and reverse-first order all work.
  - Credits and unknown actions change nothing, and renewal adjustments go to review.
- **Claims and admin:**
  - revoked orders disclose no key;
  - an unknown order and a wrong claim token get the same 401;
  - admin needs its token and refuses browser origins;
  - every credential is 256-bit, so the approximate rate limiter is not the boundary (Research: VERIFIED as approximate).
- **Seats and trials:**
  - five concurrent activations give exactly three seats, and the same computer twice uses one;
  - an activation token cannot refresh from another device;
  - the same firmware cannot start a second trial.
- **Paid clock and offline (ADR-623 Amd 2):** a paid licence never reads the clock; 1990, 2099 and five years offline all stay `ready`/`pro`.
- **What removes saved rights:** only `license_revoked`, `activation_released` and `activation_inactive`. Network errors, 5xx, 429, captive portals and garbage replies keep them.
- **Trial rules (ADR-592):** +300 s is accepted and ±301 s gives `clock-error`. Three days exactly is `ready`, and three days plus one second is `checkin-required`.
- **Grant verification:**
  - Ed25519 with pinned key IDs, canonical encoding and 64-byte signatures;
  - claim and device-binding checks;
  - tampered grants, other-device grants and unknown key IDs are refused;
  - a refresh sends no nonce (ADR-592 Amd 3).
- **Updates:**
  - **Downgrades and replays are refused on both lanes.** The app never sets `channel`, `allowDowngrade` or `allowPrerelease`, and the signed lane takes only versions above the current one. (Research: setting `channel` would turn on `allowDowngrade`: VERIFIED.)
  - **The web installer is disabled, as is differential download** on the signed lane.
  - **Paths cannot be traversed:** installer names come from the validated signed version.
  - **Coverage (ADR-623 decision 6)** compares the signed `publishedAt` with the signed `updatesUntil`, so the answer is the same at every clock.

## Not verified

- Whether Paddle can deliver several partial refunds that add up to a full refund (UNSOURCED). Either way, they are recorded for review (O3-P3-1).
- Whether Paddle creates chargebacks already `approved` (UNSOURCED). The code revokes on `approved` and handles `pending_approval` → `approved`.
- Whether a replayed Paddle notification is re-signed with a fresh `ts` (UNSOURCED). If it is not, a replay older than five seconds is refused with 401 and must be re-sent from the dashboard.
- **Runbook note (not a defect):** if licensing is switched off, or the webhook secret is wrong, for longer than Paddle's retry window of about two days, completed payments are dropped on Paddle's side and need a dashboard replay.

## Pull requests

| PR | Findings | Redeploy |
|---|---|---|
| #1772 | O3-P3-1, O3-P3-2, O3-P3-3 | Worker redeploy (maintainer) |
| #1774 | O3-P3-4 (closes rolling v2 P3-9) | next desktop release |
