## ADR-523 Amendment 2 - Licence client fixes: only trials watch the clock, stuck sign-outs end, the licence file survives power cuts (2026-09-29)

**Status:** Implemented in the desktop app's main process; the licence service is not deployed yet | **Date:** 2026-09-29 | **Amends:** ADR-523 (licensing trust and machine operation), ADR-523 Amendment 1

### Context

A second review of the desktop app's licence client found these gaps:

1. The clock check locked Pro for paid and developer licences as well as trials.
   A clock that ran ahead and was then corrected, or a dead CMOS battery, locked
   their Pro tools and held back their updates. Those licences never expire, and
   ADR-523 says paid eligible versions work offline indefinitely and describes
   clock high-water checks for the trial only.
2. A computer whose clock was more than five minutes off could not activate,
   start a trial, refresh or finish a paid claim, and was told the licence
   service or secure storage was unavailable.
3. A deactivation stayed pending for ever after a definite refusal (the service no
   longer knew the seat) or when the saved credential no longer verified. While
   it was pending, the app would not activate or start a trial, and Help >
   Licence offered only Retry. The only way out was deleting the licence file by
   hand.
4. The error messages were a plain object, so a code such as `constructor` found
   an inherited member. Some codes the service sends had no message, some it
   never sends were listed, `checkout_pending` promised a checkout that might
   never come, and a refresh answered `trial_expired` or `license_inactive` said
   the saved licence kept working.
5. Every licence read, action and update candidate started reg.exe, with a
   5-second timeout, to read the device identity.
6. The trial's clock mark and the weekly refresh ran only at launch and when Help
   > Licence opened. A clock set back between launches could stretch a trial,
   and a computer left running never had its weekly check.
7. The licence file was renamed into place without being flushed to disk, Reset
   deleted an unreadable file, and every status read rewrote the file.
8. The check on a saved order accepted upper-case transaction IDs, which the
   service never issues and the browser guard refuses.
9. A computer that got paid Pro by entering a key kept a stale unfinished
   purchase, which hid Renew.

### Decision

1. **Only a trial is held to the clock.** The rollback check (a clock more than
   five minutes earlier than the last check or the grant) applies only to rights
   that expire, which only a trial has. That holds for Pro tools and for
   updates. Paid and developer licences work offline whatever the clock says.
2. **A wrong clock is named as one.** A fresh grant issued more than five minutes
   from this computer's clock is still refused, for every tier. The app now shows
   the clock-error state, says roughly how far off the clock is and which way,
   and asks the customer to turn on Set time automatically in Windows' Date &
   time settings and check the time zone. The trial's clock message asks for the
   same. As after any refused licence check, updates wait until a later check
   succeeds.
3. **A stuck sign-out has a way out.**
   - A definite refusal (`invalid_credentials`, `activation_not_found`, a
     cancelled or inactive licence), or a saved credential that no longer
     verifies here, signs the computer out and clears the pending record. Any
     saved order is kept. The message says the seat may still count as one of
     the three devices, and how to use Pro again or have the seat freed.
   - A seat the service has already released counts as done. A retry refused
     with `release_limit_reached` gives the licence back to this computer, as the
     first attempt already did.
   - An outage, a rate limit or an unclear answer keeps the deactivation pending
     for Retry, as before.
   - An explicit activation or trial now goes ahead while a deactivation is
     pending, and its grant replaces the pending record.
   - Help > Licence offers Reset saved licence while a deactivation is pending.
     Reset then drops only the pending deactivation and keeps any saved order.
4. **Error codes are looked up safely and match the service.** The messages are a
   Map. There are now messages for `idempotency_conflict`,
   `renewal_requires_paid_license`, `invalid_provider_response`,
   `payment_mismatch`, `provider_order_reused`, `invalid_license_tier`,
   `activation_not_found`, `invalid_request` and the other request-format
   answers. They also cover two codes the service is gaining: `checkout_failed`
   (the payment provider would not start checkout, nothing was charged, try
   again) and `payment_rejected` (a payment arrived but matched no licence: do
   not pay again, email support@kerfdesk.com with the order number). The unused
   `device_limit`, `trial_already_used` and `invalid_license` are gone;
   `activation_released` stays because the released-seat rule names it.
   `checkout_pending` now points to Forget this order when checkout never
   becomes ready, and a refresh answered `trial_expired` or `license_inactive`
   says so instead of promising the saved licence keeps working.
5. **The device identity is read once per process.** The first successful read
   is kept. A failed read is not, so the next request tries again.
6. **The quiet check repeats every 30 minutes.** While KerfDesk is open, a timer
   runs the background refresh (the weekly confirmation when it is due) and
   moves a trial's clock mark on. The timer never keeps KerfDesk from quitting
   and stops when it quits.
7. **The licence file is written durably, and Reset never deletes it.** A write
   flushes the temporary file to disk before renaming it into place. Reset
   renames an unreadable file to `commercial-licence.v1.unreadable-<time>`, keeps
   the newest three such files, and never discards a record it can read. The
   clock mark is saved only for a trial, and only once it has moved at least a
   minute.
8. **One lower-case transaction-ID check** (`txn_` and 26 characters of
   `[a-z0-9]`) guards both the saved order and the checkout link the browser
   opens.
9. **A key that unlocks paid Pro drops an unfinished purchase.** The message
   names the order and asks the customer to email support if they did pay for
   it. A saved renewal is kept, because paying it still renews the licence on
   the service.

A licence still never stops the app opening, a job running or any machine
control; only Pro tools lock (ADR-540). ADR-544's defences are unchanged: signed
grants, the device binding, the fresh-grant time check and the closed update
check after a refused grant all stay.

### Consequences

- Help > Licence shows Reset saved licence for an unreadable record and for a
  pending deactivation. The panel still hides the key form and the trial while a
  deactivation is pending, so there the ways out are Retry and Reset; the main
  process already accepts an activation or trial if the panel offers one later.
- Up to three unreadable licence files can sit beside the licence in the data
  folder, where support can find them.
- A trial's clock mark can trail the real time by up to 30 minutes, on top of
  the five-minute tolerance.
- While the weekly confirmation is due but failing (offline, an outage or a
  wrong clock), each 30-minute check tries it again.
- A computer that stays signed out after a refused deactivation may still hold a
  seat on the service. Activating that computer again with the key reuses the
  seat; support can free it with the key.

### Tests

- `electron/licensing-runtime.test.ts`: the trial-only clock check for Pro and
  updates; the clock-error state and message for a skewed grant on activation,
  trial and refresh; the clock mark saved only for trials, after a minute and at
  each quiet check; every way out of a pending deactivation; Reset keeping a
  readable licence; dropping a stale purchase; refusing an upper-case checkout
  link.
- `electron/licensing-clock.test.ts`: the clock rules and the clock message.
- `electron/licensing-messages.test.ts`: every error code in the service source,
  plus `checkout_failed` and `payment_rejected`, has a message, apart from codes
  only the payment webhook or the admin API can receive; `constructor` and
  `__proto__` find nothing; the refresh and checkout wording.
- `electron/licensing-boundaries.test.ts`: the flushed write, setting aside and
  pruning unreadable files, and the device-identity cache.
- `electron/licensing-schedule.test.ts` and `electron/desktop-licensing.test.ts`:
  the 30-minute timer that never holds KerfDesk open, no overlapping checks,
  stopping at quit, and one device-identity read per process.
- `src/ui/licensing/LicencePanel.test.tsx`: Reset beside Retry while a
  deactivation is pending.
