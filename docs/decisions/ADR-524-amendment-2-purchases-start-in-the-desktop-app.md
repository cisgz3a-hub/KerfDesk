## ADR-524 Amendment 2 - Purchases start in the desktop app, and the trial waits for its release (2026-09-29)

**Status:** Accepted | **Date:** 2026-09-29 | **Amends:** ADR-524 decision 4, ADR-524 Amendment 1
decision 1

### Context

ADR-524 decision 4 and Amendment 1 decision 1 open sales by pasting "an https hosted checkout per
plan" into `website/commerce.config.mjs`. The licence service cannot fulfil such a checkout. The
desktop app starts every purchase: `POST /v1/checkout` creates the order and its Paddle
transaction, the app keeps the order's claim token, `kerfdesk.com/buy.html` opens that transaction,
and the app claims the licence once Paddle's webhook confirms the payment (ADR-523). The service
fulfils only transactions it created. A payment link or hosted checkout made in Paddle's dashboard
would take a buyer's money and never become a licence.

The pricing page also said "Try Pro free for 30 days" and "No card needed" without saying that the
desktop app, which runs the trial, is not released yet. The home, FAQ and download pages said the
same.

### Decision

1. **The website never links a checkout.** `website/lib/commerce.mjs` refuses any plan that
   carries a `checkoutUrl`, whether sales are open or closed, and the plan shape no longer has one.
   Once sales open, the Pro card links the download page and says to buy inside the app, from
   Help > Licence. Opening sales still needs the authorizing commercial ADR and the published terms
   of sale and refund policy (ADR-524 decision 4).
2. **`trialOpen` says whether the trial is out.** It is false until the licensed Windows app is on
   the download page and the licence service is switched on. Until then the pricing, home, FAQ and
   download pages say each device gets the trial once the desktop app is released, the pricing
   FAQ answers "Can I try Pro today?" with "Not yet", and the Pro card says only "Purchase opens
   soon". Once it is true, the Pro card links the desktop app. Sales cannot open before it.

### Consequences

- `website/tests/commerce.test.mjs` pins the refusal of any checkout URL, the trial wording in both
  states, and that an open store links the desktop app and no checkout.
- Setting `trialOpen` is its own change, after the first licensed release reaches the stable
  catalogue and the service is switched on (`docs/desktop-commercial-launch.md`).
- Nothing deploys the website automatically (ADR-524), so this changes nothing live until the
  site is published. The app's own download page (`public/download.html`) is separate and reads
  the release catalogue itself.
