## ADR-577 - Buy Pro opens the purchase page, and licence owners free their own seats (2026-10-09)

**Status:** Accepted by the owner's instruction ("the button should open buy page directly") |
**Date:** 2026-10-09 | **Amends:** ADR-524 Amendment 2 (how a purchase starts), ADR-523 Amendment 2
(the licence panel's actions)

### Context

Since ADR-562 the first-party page `kerfdesk.com/buy.html` can take a purchase on its own: it
creates the order with `POST /v1/checkout`, opens Paddle for that transaction, and after the
signed webhook fulfils the order it claims and shows the licence key. The desktop app still started
its own purchase: `POST /v1/checkout` from the main process, a saved order on the device, the same
page opened for that transaction, then Check payment. Two purchase paths meant two things to
qualify and two ways to get stuck. With checkout closed on the service, the app's path also left a
"pending order" with no number on every device whose owner merely clicked Buy Pro.

Separately, a lost, sold or reinstalled computer kept one of the licence's three seats until
support called the service's key-authenticated routes by hand, although ADR-523 Amendment 1 gave
the key's owner those routes exactly for this.

### Decision

1. **Buy Pro opens the purchase page itself.** In Help > Licence and in the Pro tool dialog, Buy
   Pro opens `https://kerfdesk.com/buy.html` (the sandbox build opens its own origin) in the
   browser and saves nothing on the device. The page takes payment and shows the key; the buyer
   enters it under Licence key. The main process opens only that exact address.
2. **Renewals still start in the app.** The browser page is purchase-only (ADR-562) and a renewal
   must name the licence it extends, so Renew updates keeps `POST /v1/checkout` with this device's
   activation credentials, the saved order and Check payment. A device that already holds a saved
   purchase order keeps Check payment, Reopen checkout and Forget this order until it is claimed or
   forgotten, so no paid order is stranded by this change.
3. **Only a fresh refused intent is dropped.** If the first request for a newly created intent
   is refused before any provider call (checkout closed, or a renewal key the service does not
   accept), the app drops that new intent instead of showing a pending order. An inherited intent
   keeps its request ID even after a later refusal: an earlier answer may have been lost after the
   server created a payable order, and these checks precede the service's prior-order lookup.
   Ambiguous answers (`checkout_pending`) also keep the intent.
4. **Manage devices.** Help > Licence lists the seats the saved or typed licence key holds, through
   `POST /v1/licenses/activations`, and frees one through `POST /v1/licenses/deactivate` after a
   confirming second click. Nothing changes on the calling device until its next licence check; the
   panel says to prefer Deactivate this device for the computer in use. This adds no licence check
   anywhere: it uses two routes the service already granted the key's owner.
5. **The buy page's checkout defaults** pass `showAddDiscounts: false` to `Paddle.Initialize`, so the
   checkout Paddle.js opens by itself for a payment link, like the one the page opens, offers no
   discount field; the service refuses discounted payments.

### Consequences

- `ADR-524 Amendment 2` decision 1 still holds for the website: it links no provider checkout. Its
  statement that every purchase starts in the desktop app is superseded; the desktop app now sends
  buyers to the first-party page, which is the one purchase path to qualify.
- Pricing and buy-page copy already say "Buy in this browser or from Help > Licence in the Windows
  app", which remains true.
- The support note on three active devices now points customers to Manage devices first.

Repair qualification (2026-10-10): device rows and confirmation belong to an exact
saved/typed key and adapter session; stale answers cannot overwrite a new session.
Free/invalid builds reject device management before reading saved credentials.
A confirmed removal remains confirmed if the follow-up list cannot be refreshed.
Failed browser opening points to the same sandbox or production purchase page
that was requested. Regression tests cover these ownership and recovery paths.
