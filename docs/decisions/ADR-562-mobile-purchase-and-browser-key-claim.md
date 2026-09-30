## ADR-562 - Mobile purchase page and browser licence key retrieval

Date: 2026-09-30

Status: Accepted by the maintainer's explicit request to show the purchase page on mobile phones and tablets and allow browser purchases. Live payments remain disabled.

Amends: ADR-523's desktop-originated checkout and browser completion scope. Free/Pro tool scope, desktop activation and the unsigned distribution decision remain unchanged.

### Decision

1. Mobile phones and tablets enter a lightweight responsive licence purchase page without loading the design canvas. A mobile purchase buys the Windows desktop licence; it does not provide a mobile Pro workspace or consume a device seat. Desktop browsers retain the Free workspace. Device detection uses available browser signals and is best effort; it is not a licence or security boundary.
2. The exact first-party origin `https://kerfdesk.com` may call `POST /v1/checkout` with exactly `{requestId,operation:"purchase"}` and `POST /v1/orders/claim` with exactly `{orderId,claimToken}`. The public Worker and authority validate the origin, and the authority restricts browser request bodies. All other authority routes still reject Origin headers. Browser renewal, activation, trial, webhook and administration are outside this exception.
3. CORS preflight allows only JSON POST and the `content-type` request header. It creates no order and does not call the authority or provider. Real purchase and claim requests retain their existing edge rate limit, bounded body validation, no-query-string rule and redacted logging. Answers use an exact origin, `no-store` and no ambient credential support; CORS never substitutes for the secret claim credential.
4. New purchases require public checkout configuration to be enabled. The page creates a cryptographically random 32-byte request ID and persists it before contacting the service. A browser lock serializes new order creation across tabs. Returned order and claim credentials must be validated and persisted before Paddle opens. A missing or unwritable durable browser store blocks creation. Retries preserve the same request ID and order after ambiguous results; they never silently create another payable transaction.
5. The browser stores claim credentials only in first-party browser storage and transmits them only in JSON bodies to the fixed licensing origin. They must never enter URLs, referrers, logs or analytics. The restrictive checkout CSP remains in place; first-party storage is accessible to scripts on that origin and is not equivalent to Electron safeStorage. Customers must be told to save their key and receipt, especially in private browsing or on a shared device. Displayed licence keys need not be redundantly persisted.
6. Paddle completion events only prompt the customer to select **Check payment**; they do not automatically claim a key or prove payment. Only the existing authenticated matching payment webhook fulfils the order. The claim endpoint returns the key after fulfilment, without issuing an activation. Existing order credentials can retrieve that key repeatedly after refresh and after payments close, while the licensing service remains enabled. The desktop `_ptxn` checkout path retains its original return-to-app behavior.
7. The minimal flow displays and copies a purchased key. It adds no automated email delivery or recovery service. If site data is lost, support uses the receipt's transaction ID for authenticated operator lookup and separately verifies the purchaser before privately returning a key. A receipt ID alone is not authentication; there is no public licence lookup by receipt.
8. Deployment does not enable payments, change secret values, migrate storage or rename Durable Object bindings. The production `PAYMENTS_ENABLED` flag remains false until the live merchant setup and mobile purchase recovery are qualified. Individual sellers are supported by Paddle; a registered company or paid code-signing certificate is not introduced as a requirement by this change.

### Verification and remaining launch work

Focused tests cover denied foreign/null origins, protected authority routes, browser renewal and extra credentials, restrictive preflight, safe disabled/rate-limited errors, idempotent purchase, repeated authenticated claim and zero device seats. Real local workerd/SQLite exercises the complete browser purchase and webhook claim boundary with synthetic keys and an intercepted provider, making no merchant requests.

Live selling still requires Paddle's actual live approval and payout/identity verification, approved checkout domain and payment link, one-time USD catalog, live client/API credentials and webhook configuration. An individual's own identity is verified; Paddle's separate business-verification phase is not required for individuals or sole traders. Complete mobile checkout, refresh/recovery and support handoff in sandbox before opening sales. These checks do not establish current merchant approval, deploy the Worker or accept real payment.

Primary sources checked 2026-09-30:

- [Paddle account verification](https://www.paddle.com/help/start/account-verification/what-is-account-verification)
- [Paddle setup checklist](https://developer.paddle.com/build/set-up-checklist/)
- [Paddle completed transaction event](https://developer.paddle.com/webhooks/transactions/transaction-completed/)
- [Cloudflare Workers CORS response handling](https://developers.cloudflare.com/workers/examples/cors-header-proxy/)
