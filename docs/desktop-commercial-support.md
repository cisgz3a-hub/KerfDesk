# Commercial desktop support playbook

Internal guide for whoever answers KerfDesk licence and payment questions. It
lists what the customer sees, what the software guarantees, and the operator
action for each situation. It is not customer-facing text, and it does not
authorize enabling payments; see `desktop-commercial-business-decisions.md`.

Customers write to support@kerfdesk.com, which Cloudflare Email Routing forwards
to the owner's inbox; the support page (`public/support.html`) and the website
name that address and no other.

Operator actions use the private administration and licence APIs described in
`services/desktop-licensing/README.md`. Keep the administrator token, licence
keys and claim tokens out of chat, email threads, tickets, screenshots and shell
history; load the token from protected storage into an environment variable for
the single command that needs it.

## What a customer owns

| Edition | Access | Updates | Computers |
| --- | --- | --- | --- |
| Trial | 30 days from the first online registration | Releases published during the trial | 1 (the trial belongs to one Windows installation) |
| Paid licence | Forever, for eligible versions | Releases published on or before the update cutoff; one year from purchase, plus one year per US$20 renewal | 3 active at once |
| Developer (Johann, Father) | Forever | All future releases | 3 active at once |

- Help > Licence shows the tier, the trial end or the "Updates through" date, and
  the actions available on that computer.
- KerfDesk always opens (ADR-540). Without Pro it runs KerfDesk Free: only the
  Pro tools (V-carve, 3D relief, adaptive clearing, advanced tracing, camera
  alignment, box generator, Design Studio, G-code Inspector) ask for a licence.
  Existing desktop projects that use them still preview, frame, start and save G-code.
- A version released after the update cutoff opens as Free with "This version is
  newer" and the update date in Help > Licence. Older eligible versions keep Pro
  and stay downloadable under **Earlier versions** on the download page.
- Pro stays unlocked for the rest of a running session even if a trial ends.
  Nothing a licence does can stop a running job.
- The web app and the free Preview builds never need a licence. Those builds run
  KerfDesk Free and send Pro tools to the desktop app. Browser Free preserves Pro
  machining projects for desktop, with a complete Save As copy; it does not remove
  their operations or overwrite an unsupported autosave (ADR-540 Amendment 1).

## Situations

### Something went wrong

Ask for **Help > Save Support Report** (ADR-546). The customer saves a text file
and attaches it: version and build, web or desktop app, edition (never the key),
computer, machine profile, connection and controller check, machine state, `$$`
settings, the last 100 machine console lines, the window's recent errors and, in
the desktop app, the newest part of its log. If the app will not open, ask for the
log files instead: `%APPDATA%\laserforge\logs\kerfdesk.log` and `kerfdesk.1.log` on
Windows. Each log line gives the time, level and source (`app`, `main` for the
main process, `window` for the app window). A startup line without a `KerfDesk
quit.` line before it usually means the previous session ended abnormally: a
crash, a forced close or a power cut.

A job that stopped when Windows restarted, shut down or signed out leaves a `main`
line starting "Windows asked to end the session" (KerfDesk asked Windows to wait)
or "Windows is ending the session" (KerfDesk tried to send Abort, which Windows can
cut off), with Windows' reason (ADR-548). The Abort may never have reached the
machine, so ask whether the spindle or laser stayed on. Point the customer to
Windows Update's Active hours and to the connection guide's "Disconnects during a
job", and tell them to finish or Abort a job before letting Windows restart.

### An update did not arrive

Ask what **Help > Check for Updates** says (ADR-547).

- "KerfDesk is up to date": the computer has the newest version its ring lists.
  Everyone gets a new version once it has had four quiet days in beta (ADR-541);
  **Get new versions early (beta)** gets it sooner.
- "... is ready. It installs when you close KerfDesk.": close KerfDesk when no job
  is running, and it installs then.
- "... is out, but your licence's updates ended on ...": the version they have keeps
  working. A renewal covers newer versions.
- "KerfDesk couldn't check for updates": the computer could not reach
  `dl.kerfdesk.com`. Check the connection and any firewall, then **Check now**.
- "... couldn't be prepared": the download failed its checks, and KerfDesk tries
  again the next time it opens. If it keeps failing, ask for a support report: its
  log says why.
- "This copy of KerfDesk doesn't update itself": a Preview or source build. Point
  them to the download page.

### The trial will not start

The first registration needs the internet. "Unable to reach the licence service"
means no connection or the service is down. "Too many attempts" is the trial rate
limit: 5 trial starts a minute from one internet address (for IPv6, one /64
network, which is usually one home or office). Waiting a minute clears it. A
shared connection (an office, a school, a mobile carrier) can meet it sooner.

Check the service first: `https://license.kerfdesk.com/v1/public/health` answers
`{"ok":true}` when the service and its database are up, and `{"ok":false}` with
status 503 when they are not. It answers even while licensing is switched off, but
only after the Worker is redeployed with ADR-523 Amendment 3: the Worker deployed
from 27855387e predates the route and answers 503 `service_unavailable`.

### The trial was already used on this computer

Trials belong to the Windows installation. Reinstalling KerfDesk, or starting the
trial from another Windows account on the same PC, returns the original trial and
its original end date. A new trial after it ends is not available; offer the
purchase instead. Reinstalling Windows creates a new installation identity, and
this service does not claim to prevent that.

### A wrong computer clock

Only a trial watches the clock (ADR-523 Amendment 2). A paid or developer licence
keeps Pro whatever the clock says.

- "This computer's clock is earlier than the last licence check, so the Pro tools
  in your trial are locked...": the clock moved back more than five minutes during
  a trial. Ask the customer to turn on **Set time automatically** in Windows' Date
  & time settings, then choose **Refresh licence** in Help > Licence.
- "This computer's clock is about N minutes (or hours, or days) ahead (or behind),
  so the licence could not be confirmed...": an activation, trial start, refresh or
  Check payment met a clock more than five minutes from the licence service's, for
  any licence. The saved licence is kept, and updates wait until a check succeeds.
  Ask for automatic time and the right time zone, then try again.

### "This licence already has three active devices"

The customer deactivates a computer they still use from Help > Licence >
Deactivate this device. If that computer is gone (failed disk, sold, reinstalled
Windows), the customer frees its seat themselves from Help > Licence > **Manage
devices** on any computer, with their saved or typed licence key: the list shows
each seat (labelled only `Windows computer` with its activation date) with a
Remove action that asks once to confirm. The same two service routes serve the
operator when the customer cannot: `POST /v1/licenses/activations` lists the
active seats and `POST /v1/licenses/deactivate` frees one. Confirm which seat
with the customer by activation date. The customer never has to send the key in
a ticket if they can do this on a working computer instead.

### Deactivation says "retry deactivation to free its seat"

The computer signed itself out but could not reach the service to free its seat.
Help > Licence offers **Retry device deactivation** (online) and **Reset saved
licence**, which stops trying. Until the seat is freed it still counts as one of
the three devices; the operator can free it as above.

The computer stops retrying by itself when the service gives a definite answer:

- The seat was already free: the deactivation counts as done.
- The service no longer knows the seat or the licence (`invalid_credentials`,
  `activation_not_found`, a revoked or inactive licence), or the saved credential
  no longer verifies: "This computer is signed out of its licence, but its seat
  could not be freed from here, so it may still count as one of your three
  devices." Free the seat as above if the customer needs it.
- `release_limit_reached`: the licence has used its deactivations for now, and
  the computer keeps its licence, as it did at the first attempt.

A customer who chose Reset while it was pending sees "This computer stopped trying
to free its licence seat, so the seat may still count..."; handle it the same way.
Entering the licence key on that computer again reuses its seat.

### "The licence saved on this computer can't be read"

Usually after a Windows account or password reset, which loses the key that
encrypted the licence. **Reset saved licence** in Help > Licence renames the file
to `commercial-licence.v1.unreadable-<time>` in the data folder (Help > Open Data
Folder); the newest three are kept. The customer then enters the licence key again,
and the computer keeps its seat. Reset never touches a licence that can be read.

### The customer needs their licence key for another computer

The key is shown in Help > Licence (Show key, Copy key) on any computer that was
activated with it or bought it, and right after a purchase. The key activates up
to three computers; a fourth needs one of the others deactivated first.

If no activated computer remains, find the licence with
`POST /v1/admin/licenses/lookup` using the order number (shown in the app while
the order was pending), Paddle's transaction ID (`txn_...`, from the Paddle
receipt or dashboard) or the licence ID, and send the key privately to the
purchaser only. The lookup is audited as a key disclosure.

### Paid, but the app still says payment is pending

Only a verified Paddle `transaction.completed` webhook grants a licence. Ask the
customer to select **Check payment** on the computer that started the checkout;
that computer holds the order's claim credentials.

- `payment_pending`: Paddle has not reported the completed payment yet. Check the
  transaction in Paddle and the webhook delivery log. Redeliver the webhook from
  Paddle if it failed; duplicates are safe.
- `payment_rejected`: Paddle took the money but the service refused the payment.
  See "The payment was refused" below.
- `checkout_pending`: the service could not confirm that Paddle created the
  transaction (Paddle timed out or answered with a server error). Find the transaction in Paddle by the customer's email and time.
  **Never ask the customer to pay again.** If Paddle shows a completed payment, its
  webhook reconciles the order and Check payment then works. If Paddle has no
  transaction for the order, the app keeps reporting "Checkout is still being
  prepared" for that saved order, because retrying the same order never creates a
  second transaction. The customer can choose **Forget this order** in Help >
  Licence, which starts a fresh order and checkout next time. Only suggest that
  after confirming in Paddle that the old order was not paid; if it was, look up
  its licence by order number instead.
- The customer entered a licence key after starting a purchase: the app removed
  the unfinished order and said "If you did pay for order <id>, email
  support@kerfdesk.com with that order number." Look that order up; if it was
  paid, its licence is separate from the key they entered.
- The checkout started on a computer that has since been reinstalled or lost: the
  claim credentials are gone with it. Reconcile the order with
  `POST /v1/admin/orders`, claim it with `POST /v1/orders/claim`, and send the
  returned licence key privately to the purchaser.

### The payment was refused (`payment_rejected`)

Paddle charged the customer, but the payment did not match what the service sold,
so it granted nothing and recorded why. The app tells the customer not to pay
again and to email support@kerfdesk.com with the order number. Paddle stops
retrying the webhook, because the service answered it.

Look up the order number, or the Paddle transaction ID, with
`POST /v1/admin/licenses/lookup`. The `rejection` field gives the code, the
transaction and the amounts Paddle reported. Then act on the code:

| Code | What happened | What to do |
| --- | --- | --- |
| `payment_mismatch` | The charge differed from the fixed price: a discount, a quantity other than 1, another price or currency, totals that don't add up, a subscription, or a payment without the order's proof | Refund it in Paddle. Check both Paddle prices allow quantity 1 only and that no discount applies. After the refund the customer can check out again, as a new order. |
| `payment_not_completed` | The transaction was not in the completed state | Check it in Paddle. Refund it if money was taken. |
| `order_already_paid` | A second, different payment for an order that already has its licence | Refund the second payment. The licence from the first payment is unaffected. |
| `renewal_requires_paid_license` | A renewal was paid for a licence that was revoked, or is not a paid licence | If the licence should be active, restore it (`status: "active"`), then redeliver the webhook from Paddle: the renewal is then applied. Otherwise refund it. |
| `unknown_order` | The payment names an order this service does not hold: a restored database, a sandbox order paid in live, or an order deleted on request | If the payment is genuine, record the order with `POST /v1/admin/orders` (the order number from the transaction's `kerfdesk_order_id`, `provider: "paddle"`, the `txn_` ID, the operation), redeliver the webhook, then claim the order and send the key privately. Otherwise refund it. |
| `license_already_exists`, `provider_order_reused`, `payment_reused` | The payment collides with a record that already exists | Rare, and a sign of a restored or edited database. Check the lookup for each ID involved before refunding. |

A redelivery changes nothing unless the cause is fixed, so redelivering is always
safe. A payment that only names an order (without the order's proof, or bound to
another transaction) is recorded but never blocks that order: its own payment
still fulfils it.

A completed Paddle transaction without a KerfDesk order number, such as one made
by hand in the Paddle dashboard, is acknowledged and ignored. It never grants a
licence and leaves no record in the service: sell only through the app's checkout.

### Checkout could not start (`checkout_failed`)

Paddle refused to create the transaction (`checkout_failed`), or answered with
something the service will not hand out (`invalid_provider_response`): the wrong
price or amount, or a missing or unapproved checkout link. **Nothing was charged**:
no customer ever received a link to pay. The order is marked failed, and the
customer's next attempt starts a fresh order.

This is a configuration problem, not the customer's. Look up the order number: its
`failure` field gives the code, and for `checkout_failed` Paddle's HTTP status and
error code. Typical causes are an archived or wrong price ID, a Paddle API key
without permission to create transactions, or no approved default payment link
(`https://kerfdesk.com/buy.html`). Fix it in Paddle or the Worker configuration,
then ask the customer to try again.

### Renewal

Renewing adds one year to the later of the current update cutoff and today. The
customer renews from Help > Licence on an activated computer, pays, then selects
**Check payment** on that computer, which refreshes its licence with the new
"Updates through" date. The customer's other computers pick up the new date with
**Refresh licence**. A renewal never changes which older versions already work.

### Refund or chargeback

Follow the refund policy in the published terms, then revoke the licence with
`POST /v1/admin/licenses/status` (`status: "revoked"`). Its key stops activating
at once, and connected computers drop Pro at their next weekly check. A computer
kept offline keeps its signed rights until it reconnects, so do not promise more
than that. Restore with `status: "active"` if a chargeback is reversed.

### A licence key leaked

Rekey the licence instead of revoking it: `POST /v1/admin/licenses/rekey` with
`{licenseId}` returns a new key, and the old key stops activating at once. Add
`releaseSeats: true` when unknown computers hold seats: every seat is freed
(without using up the customer's six moves), and each computer loses Pro at its
next weekly check. Send the new key privately to the purchaser, who activates
their own computers with it. A later lookup returns the new key too.

### Privacy or deletion request

The licensing service holds hashed credentials and device digests, licence,
activation and order IDs, generic device labels, dates, and for a refused payment
its amounts. It holds no name, email or address. Paddle holds the payment and
contact details, and its own deletion process covers them.

1. Confirm the requester's identity from the Paddle receipt or the email that
   bought the licence, and ask for the order number or Paddle transaction ID. If
   they have only their key, ask for just the licence ID, the middle part of the
   key (`KD1.<licence ID>.<...>`), never the whole key.
2. Look it up (`POST /v1/admin/licenses/lookup`) to find the licence.
3. Revoke a paid or developer licence (`status: "revoked"`); the deletion refuses
   an active one with `license_not_revoked`. A trial needs no revoke.
4. `POST /v1/admin/customers/delete` with `{licenseId}` or `{orderId}` deletes the
   licence, its seats, grant, orders and their payment records in one step, and
   returns how many records went. Delete each other order number the customer
   gives you the same way: the service cannot tell which orders belong to one
   person, because it holds no contact details.
5. Keep what law or the terms require in Paddle; the service's audit records keep
   only the random IDs and what was done.

Deleting a trial frees that Windows installation to start a new 30-day trial.

## Operator procedures

- **Developer grants.** `POST /v1/admin/developer-grants` with `{grantId: "johann",
  displayName: "Johann"}` or `{grantId: "father", displayName: "Father"}`. Repeating
  the request returns the same licence. Store each key privately and give it only
  to its owner. There is no universal unlock key.
- **Reissuing a lost key.** Licence keys are derived from the licence ID and its
  key version with the service's derivation secret, so the same key can be
  reproduced until the licence is rekeyed. `POST /v1/admin/licenses/lookup`
  returns it; never paste the key into a shared system.
- **Audit.** Every administration call, including a refused one, adds an
  `audit:<time>:<sequence>` record with the route, the licence, order or grant
  involved, the outcome, which administrator token was used and the time. The
  export includes them. Review them after anything unexpected, and at least after
  every token rotation.
- **Rotating the administrator token.** Set a new random value as the Worker
  secret `ADMIN_TOKEN_NEXT`; both tokens then work. Move your tools to the new one,
  set it as `ADMIN_TOKEN`, then delete `ADMIN_TOKEN_NEXT`: the old token stops
  working. Rotate after anyone who knew the token leaves, or if it may have leaked.
- **Health monitor.** Once the Worker is redeployed with the health route (the
  one deployed from 27855387e predates it), point an uptime monitor at
  `https://license.kerfdesk.com/v1/public/health`, expecting status 200 and
  `{"ok":true}`. Each check is one Durable Object request, so a check every minute
  or two stays well inside Cloudflare's free allowance.
- **Backups.** The Durable Object database and the signing, hashing, derivation
  and administrator secrets must be backed up together. `POST /v1/admin/export`
  returns every record as JSON Lines, a page at a time; keep the pages as private
  as the database. There is no restore route yet. Restoring an old database can
  resurrect old seats and orders and needs manual reconciliation.

## Known gaps to close before scale

- A customer who forgets an order that was in fact paid needs support to look up
  its licence; the app warns before forgetting and shows the order number.
- Records are deleted only on request. Nothing yet deletes deactivated devices
  after 90 days or trial records three years after the trial ends, as the draft
  privacy notice promises; that needs a scheduled job the owner must approve.
- An export can be read but not restored; there is no restore to a point in time.
- A refused payment always needs a person: a refund, or a fix and a redelivery.
- A paid licence can move seats at most six times in 30 days; support cannot yet
  lift that for one customer.
- Device labels are generic, so seat lists identify computers only by date.
