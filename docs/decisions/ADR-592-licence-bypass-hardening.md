## ADR-592 - Licence bypass hardening: refunds revoke, devices check in, trials bind to hardware, Free opens only this computer's Pro work (2026-10-12)

**Status:** Implemented in source; the service change takes effect at the next Worker redeploy and the app change at the next commercial desktop release | **Date:** 2026-10-12 | **Amends:** ADR-523 Amendments 1 and 2 (offline paid rights, clock rules), ADR-540 item 3 and Amendment 1 item 5 (desktop Free and existing Pro projects), ADR-540 Amendment 2 item 4 (trial identity), ADR-544 "What is accepted" and "Later, when abuse shows"

### Context

On 2026-10-12 the owner reported that people could bypass the licence and get Pro
free, and asked for a review. The signed entitlements, pinned keys, device binding,
seat limits and Paddle verification held up. The cheap bypasses came from policy:

1. **Template projects.** Desktop Free opened, edited and output any project that
   already held a V-carve, relief or adaptive operation. One trial user could share
   a project whose text or outline anyone could edit, weld new artwork into, or
   copy by hand-editing the JSON, giving unlimited V-carve without a licence.
2. **Repeat trials.** A trial was keyed only on the Windows installation ID
   (`MachineGuid`), which an administrator can change in the registry.
3. **Refund and keep.** Paddle refunds and chargebacks were ignored by the webhook,
   so revocation waited for support; a computer that blocked the licence server
   kept paid Pro forever because paid rights never expire.
4. **Offline trial freeze.** A trial never had to come online again, so an offline
   computer with its clock and saved record wound back could keep trial Pro.

The owner chose, on 2026-10-12: auto-revocation; a 30-day paid and 3-day trial
check-in; a firmware (SMBIOS) hardware ID for trials with safeguards; and
"settings only" for existing Pro work in Free.

### Decision

1. **Refunds and chargebacks revoke automatically.** The webhook verifies Paddle's
   signed `adjustment.created` and `adjustment.updated` events. For a fulfilled
   purchase, an `approved` full refund, chargeback or chargeback warning revokes the
   licence. Adjustment state is retained before a delayed completion, which then
   cannot create claimable refunded rights. Older deliveries cannot overwrite newer
   adjustment state. A chargeback or warning reversal corrects only its matching
   automatic revocation, and only when no full refund or other outstanding dispute
   still revokes that purchase; this also holds when delivery order is reversed.
   Partial refunds and renewal adjustments are recorded for support only. A status
   support sets by hand replaces the automatic one; a reversal or same-state
   redelivery cannot supersede it. Revoked orders cannot disclose a claim key.
2. **Devices check in.** New Pro tool choices pause when the last signed grant is
   more than 30 days old (paid) or 3 days old (trial), or when the computer's clock
   is more than five minutes earlier than that grant. The signed `issuedAt` is the
   confirmation, so editing saved files cannot extend it. Trials refresh daily,
   paid licences weekly, and an overdue device tries at once. Developer licences
   are exempt. A paid session that already had Pro keeps it until the app closes
   (ADR-540 item 4), unless the service definitively refuses that licence or seat:
   a revoked licence or released activation removes the session allowance for new
   Pro choices immediately. Existing work and output remain usable.
3. **Trials bind to hardware.** Starting a trial also sends a one-way digest of the
   firmware UUID, read through the verified System32 Windows PowerShell. The server
   refuses `trial_already_used` when that hardware already holds another
   installation's trial. Missing, all-repeated and known placeholder UUIDs are never
   sent, so an absent value can never refuse a trial. The original installation
   always reaches its own trial.
4. **Desktop Free opens only this computer's Pro work.** A commercial build's main
   process keeps one random 32-byte key per computer, protected by `safeStorage`,
   and gives it only to its own `app://` renderer. Every `.lf2` save, template,
   local snapshot and autosave from that computer carries an HMAC-SHA256 seal of
   its exact text (`kerfdeskDeviceSeal`, the last top-level property, dropped on
   read). Without Pro, a project, template, snapshot or autosave holding Pro work
   opens only when its seal verifies here; otherwise the document is unchanged and
   a dialog offers to unlock Pro. Sheets and production rows of the open document
   stay admitted. Builds without the key (Preview, free desktop) therefore open no
   Pro projects, matching the browser.
5. **Free edits settings, not artwork.** Without Pro, changing the outline of
   artwork bound to a Pro operation, adding new artwork to it, or changing a
   relief's height data asks for Pro, through every store edit path except
   history, document replacement and save tracking. Moving, scaling, operation
   settings and removal stay free.

### Unchanged

The Pro check still never gates Preview, estimates, Frame, Start, Save G-code, a
running job or machine control, and the workspace always opens. Opening a project
that was admitted keeps running its saved Pro operations. Policy findings remain
Job Review warnings.

### What is still accepted

- Patching the installed executable and `app.asar` defeats any client check
  (ADR-544). Same-user tools can read `safeStorage` data and fake a process clock;
  the check-in limits how long that lasts, not whether it is possible.
- A virtual machine has its own firmware UUID and gets its own trial.
- Projects saved before this version carry no seal: after a trial ends they need
  Pro once to reopen, and saving them under Pro seals them. A reset Windows account
  loses the old key the same way.

### Consequences

- Subscribe Paddle's notification destination to both adjustment events and
  redeploy the Worker. Update the published privacy notice (hardware code, daily
  trial confirmation, adjustment records) before the release that sends it.
- `LicenceStatus.state` gains `checkin-required`; `LicenceAdapter` gains
  `projectSealKey`.
- This decision operates no machine and changes no output. Frame remains the sole
  ordinary Start gate.
