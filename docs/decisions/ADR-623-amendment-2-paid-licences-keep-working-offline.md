## ADR-623 Amendment 2 - Paid licences keep working offline, as LightBurn's do (2026-10-20)

**Status:** Accepted | **Date:** 2026-10-20 | **Amends:** ADR-592 decision 2 (the paid half of "Devices check in") and "What is still accepted", ADR-623 decision 3, ADR-623 Amendment 1 decision 3 (the paid clock warning)

### Context

ADR-592 made every device confirm its rights online: a trial within 3 days, a paid licence within
30 days. Past that, or with this computer's clock more than five minutes earlier than the last
confirmation, new Pro choices paused. ADR-623 then put the desktop app behind a licence window
that admits a device only while its status is Pro. Together they turned a missed paid check-in
into something much larger: a paying customer offline for more than 30 days, or whose clock was
badly wrong, could not open KerfDesk at all at the next launch. The paid last-seen mark and clock
offset added after ADR-592 (#1232) made a wrong clock less likely to cause this, but kept the
30-day limit.

On 2026-10-20 the maintainer was asked whether a paying customer should be locked out like that.
They answered: "Do research on what lightburn does and copy". This is their explicit permission
to change the licence model, which AGENTS.md requires together with an ADR.

What LightBurn does:

- Its staff (Oz) wrote that LightBurn "will _try_ to connect once a day, but there's no error if
  it can't", and "will only force you to connect / check if something significant changes on your
  system" (https://forum.lightburnsoftware.com/t/licensing-questions/24087).
- A LightBurn licence is perpetual, and its update period ends one year after activation.
  Purchased licences can be activated offline. A trial needs one online activation, after which
  the computer can go offline
  (https://docs.lightburnsoftware.com/2.1/Licensing/LicenseManagement/,
  https://docs.lightburnsoftware.com/2.1/Licensing/LicenseFAQ/).

### Decision

1. **A paid licence activated on this computer keeps working offline, indefinitely.** It has no
   check-in. However long the computer has been offline, the licence window lets it in at launch
   and Pro tools stay available in a session. A paid status never reads `checkin-required` and
   carries no `checkInDueAt`, and the reminder shown before a paid check-in fell due is removed.
2. **The clock never locks a paid licence.** Reading a saved paid licence never consults the
   clock. A paid grant (an activation, **Check payment** or a refresh) is accepted whatever the
   clock says, because paid rights never end and the clock cannot change what they allow. So a
   paid licence shows no clock error or clock warning. The clock offset saved with a paid grant
   since #1232 is no longer written or read. A record that still holds one stays valid, and the
   next grant drops it. The paid last-seen mark stays: a clock wound back below it, or below the
   last refresh, still makes the next quiet check ask the licence service at once.
3. **KerfDesk keeps trying quietly.** As before, it checks at startup and every 30 minutes
   whether a confirmation is due. A paid licence stays due about weekly: LightBurn tries once a
   day, but the published privacy notice states a weekly paid confirmation, and a paid licence
   needs none to keep working, so weekly only bounds how soon a refund reaches a connected
   computer. A failed attempt saves nothing, so an offline computer tries again at each check,
   and nothing is shown while it is offline.
4. **A refund, revocation or deactivation still applies the next time the computer reaches the
   service.** ADR-592 decision 1 is unchanged: a refunded or charged-back licence is revoked on the
   service. The first successful refresh after that removes the saved rights at once, so new Pro
   choices pause and the licence window returns at the next launch. A seat released from another
   device does the same.
5. **A significant system change still forces a check.** The signed entitlement stays bound to
   this installation's device identity. Another computer, or a changed identity (for example a
   reinstalled operating system), reads the saved licence as unusable and needs activation again.
6. **Unchanged:** the update period (a release published after it is not covered and opens to the
   licence window with renewal, as in LightBurn), and developer licences, whose grants are still
   checked against the clock. Trials keep their 3-day check-in, clock rules and firmware binding
   (ADR-592). This differs from LightBurn, whose trial can go offline after its first activation:
   ADR-592 found that an offline trial with its clock and saved record wound back could keep trial
   Pro forever, and that reason still holds for a trial's set end date.

### Consequences

- The licence check still gates nothing in a running session. Frame, Start, output, Save G-code
  and a running job never read it (ADR-623, ADR-247 Amendment 1).
- Accepted cost, as with LightBurn: a refunded or charged-back copy kept offline, or behind a
  firewall that blocks the licence service, keeps paid Pro until it next reaches the service.
  ADR-592's "the check-in limits how long that lasts" no longer holds for paid licences. Support
  must not promise that an offline computer loses Pro.
- `CHECK_IN_LIMIT` holds only the trial. `verifyGrant` checks a grant's time only when
  `grantTimeChecked` says so, which is never for a paid grant. `paidClockOffset`,
  `clockWarningMessage` and the renderer's `use-checkin-reminder` are removed.
  `licenceRefreshDue` still waits a week for paid rights. `LicenceStatus.state` keeps
  `checkin-required` and `clock-error` for trials and developer grants, and the renderer handles
  them as before.
- The owner's privacy texts (the website privacy page and `docs/legal/kerfdesk-privacy-notice.md`)
  say paid licences confirm about once a week, which stays true, and need a confirmation within
  30 days, which no longer applies. The owner should drop the paid deadline from them before the
  release that carries this decision. The AGENTS.md summary of ADR-592 ("paid 30 days") is the maintainer's to
  update the same way.

### Merged with ADR-592 Amendment 1 (refresh nonce)

ADR-592 Amendment 1 landed first. Its nonce is kept for every refresh: a grant
that signs another request's nonce is refused. Its paid wrong-clock offset is
removed here, because a paid grant is no longer held to the clock.

[ADR-592 Amendment 3](ADR-592-amendment-3-refresh-nonce-withdrawn.md) (2026-10-23)
then withdrew the nonce from the app: with no paid check-in left, it protected
nothing. From 1.0.23 a refresh sends none and no grant is refused over one.
