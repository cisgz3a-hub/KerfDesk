# Commercial desktop support playbook

Internal guide for whoever answers KerfDesk licence and payment questions. It
lists what the customer sees, what the software guarantees, and the operator
action for each situation. It is not customer-facing text, and it does not
authorize enabling payments; see `desktop-commercial-business-decisions.md`.

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
  Existing projects that use them still preview, frame, start and save G-code.
- A version released after the update cutoff opens as Free with "This version is
  newer" and the update date in Help > Licence. Older eligible versions keep Pro
  and stay downloadable under **Earlier versions** on the download page.
- Pro stays unlocked for the rest of a running session even if a trial ends.
  Nothing a licence does can stop a running job.
- The web app and the free Preview builds never need a licence. Pro is sold only for the
  desktop app (ADR-540 item 7); once sales open, those builds run KerfDesk Free and send Pro
  tools to the desktop app.

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
means no connection or the service is down. "Too many attempts" is the per-IP
rate limit (30 requests a minute); waiting a minute clears it. If the service is
healthy and the customer is online, check the service status before anything else.

### The trial was already used on this computer

Trials belong to the Windows installation. Reinstalling KerfDesk, or starting the
trial from another Windows account on the same PC, returns the original trial and
its original end date. A new trial after it ends is not available; offer the
purchase instead. Reinstalling Windows creates a new installation identity, and
this service does not claim to prevent that.

### "The computer clock is earlier than the last licence check"

The clock moved backwards by more than five minutes. Ask the customer to set the
correct date and time (automatic time is best) and relaunch. A successful online
refresh or activation also resets the check.

### "This licence already has three active devices"

The customer deactivates a computer they still use from Help > Licence >
Deactivate this device. If that computer is gone (failed disk, sold, reinstalled
Windows), the operator can free the seat with the customer's licence key:
`POST /v1/licenses/activations` lists the active seats (each is labelled only
`win32 computer` with its activation date), and `POST /v1/licenses/deactivate`
frees one. Confirm which seat with the customer by activation date. The customer
never has to send the key in a ticket if they can do this on a working computer
instead.

### Deactivation says "signed out locally" or "Retry device deactivation"

The computer removed its local licence but could not reach the service. It keeps
retrying when the customer selects Retry while online. Until then the seat still
counts as active; the operator can free it as above.

### The customer needs their licence key for another computer

The key is shown in Help > Licence (Show key, Copy key) on any computer that was
activated with it or bought it, and right after a purchase. The key activates up
to three computers; a fourth needs one of the others deactivated first.

If no activated computer remains, find the licence with
`POST /v1/admin/licenses/lookup` using the order number (shown in the app while
the order was pending) or the licence ID, and send the key privately to the
purchaser only.

### Paid, but the app still says payment is pending

Only a verified Paddle `transaction.completed` webhook grants a licence. Ask the
customer to select **Check payment** on the computer that started the checkout;
that computer holds the order's claim credentials.

- `payment_pending`: Paddle has not reported the completed payment yet. Check the
  transaction in Paddle and the webhook delivery log. Redeliver the webhook from
  Paddle if it failed; duplicates are safe.
- `checkout_pending`: the service could not confirm that Paddle created the
  transaction. Find the transaction in Paddle by the customer's email and time.
  **Never ask the customer to pay again.** If Paddle shows a completed payment, its
  webhook reconciles the order and Check payment then works. If Paddle has no
  transaction for the order, the app keeps reporting "Checkout is still being
  prepared" for that saved order, because retrying the same order never creates a
  second transaction. The customer can choose **Forget this order** in Help >
  Licence, which starts a fresh order and checkout next time. Only suggest that
  after confirming in Paddle that the old order was not paid; if it was, look up
  its licence by order number instead.
- The checkout started on a computer that has since been reinstalled or lost: the
  claim credentials are gone with it. Reconcile the order with
  `POST /v1/admin/orders`, claim it with `POST /v1/orders/claim`, and send the
  returned licence key privately to the purchaser.

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

### Privacy or deletion request

The licensing service holds hashed credentials and device digests, licence,
activation and order IDs, generic device labels and dates. Paddle holds the
payment and contact details. There is no automated deletion tool: an operator
removes the customer's licence, activation and order records from the authority
database after confirming identity, and keeps only what law or the terms require.

## Operator procedures

- **Developer grants.** `POST /v1/admin/developer-grants` with `{grantId: "johann",
  displayName: "Johann"}` or `{grantId: "father", displayName: "Father"}`. Repeating
  the request returns the same licence. Store each key privately and give it only
  to its owner. There is no universal unlock key.
- **Reissuing a lost key.** Licence keys are derived from the licence ID with the
  service's derivation secret, so the same key can be reproduced but never
  changed. `POST /v1/admin/licenses/lookup` returns it; never paste the key into
  a shared system.
- **Backups.** The Durable Object database and the signing, hashing, derivation
  and administrator secrets must be backed up together. Restoring an old database
  can resurrect old seats and orders and needs manual reconciliation.

## Known gaps to close before scale

- No self-service remote seat management: customers can only deactivate the
  computer they are using.
- A customer who forgets an order that was in fact paid needs support to look up
  its licence; the app warns before forgetting and shows the order number.
- No administrator endpoint to delete a customer's records.
- A paid licence can move seats at most six times in 30 days; support cannot yet
  lift that for one customer.
- Device labels are generic, so seat lists identify computers only by date.
