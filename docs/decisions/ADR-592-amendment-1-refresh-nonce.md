## ADR-592 Amendment 1 - A wrong-clock check-in must answer the request just sent (2026-10-20)

**Status:** Implemented in source; the service change takes effect at the next Worker redeploy, which must come before the desktop release that carries the app change | **Date:** 2026-10-20 | **Amends:** ADR-592 decision 2 (devices check in) | **Amended by:** ADR-623 Amendment 2 (paid licences keep working offline); [ADR-592 Amendment 3](ADR-592-amendment-3-refresh-nonce-withdrawn.md) (2026-10-23) withdraws the app side from 1.0.23: the app sends and checks no nonce, and the Worker keeps signing one back for 1.0.21 and 1.0.22

### Context

PR #1232 (2026-10-17) let a paid refresh count as a check-in when this computer's
clock is more than five minutes off, by up to one check-in period (30 days). The
grant is kept with the measured offset, and the next check-in is timed from when
it arrived here, so a paying customer with a wrong clock keeps Pro tools.

The 2026-10-20 audit of that change found a refund gap. The refresh request
(licence, activation, device and activation token) was the same every time and
carried nothing new, so its answer could not be told apart from an earlier one. A
refunded buyer could save one real refresh answer and replay it later through a
local TLS proxy that trusts their own certificate authority. Each replay looked
like a grant from a clock that was off by the time since it was saved, so it was
accepted, and it moved the check-in due date to now plus 30 days. ADR-592's
"confirmed within 30 days" became about 60 days, and a refund took that long to
reach the computer.

### Decision

1. **Each refresh sends a nonce.** The app sends `refreshNonce`, 32 random bytes
   as 43 base64url characters, new for every refresh request, foreground or
   background. A background refresh applies its reply with the nonce of the
   request it sent.
2. **The service signs it back.** `/v1/activations/refresh` checks the nonce's
   form and signs it into the grant's claims as `refreshNonce`, under the same
   Ed25519 signature as every other claim. A malformed nonce is refused with
   `invalid_request`. A request without one, from an older app, gets the grant it
   always did. Activations and trials never carry a nonce.
3. **Only an answered nonce excuses the clock.** A paid refresh grant issued more
   than five minutes from this computer's clock counts as a check-in only when its
   signed `refreshNonce` is the one this request sent. A grant that signs any other
   nonce is refused whatever the clock says. A grant without a nonce, from a
   service not yet redeployed, is accepted only within the five-minute tolerance,
   as before PR #1232.
4. **Saved rights stay checkable.** Verifying a saved grant accepts a
   `refreshNonce` claim only in the 43-character form.

### Unchanged

The 30-day paid and 3-day trial check-ins, the five-minute tolerance, the one-period
bound on a saved offset and the refusal of trial grants with a wrong clock all stay
as they were. This adds no check: it narrows which service answer counts as the
confirmation ADR-592 already requires. The Pro check still never gates Preview,
estimates, Frame, Start, Save G-code, a running job or machine control, and
existing work and output stay usable. Developer licences remain exempt.

### What is still accepted

- Replaying a grant within five minutes of its issue, on a correct clock, gains at
  most those five minutes.
- A grant saved before the Worker redeploy carries no nonce. Replaying it still
  passes the ordinary check on a clock wound back to within five minutes of its
  issue. That is the clock faking ADR-592 already accepts, together with patching
  the executable (ADR-544).

### Consequences

- Redeploy the licensing Worker before releasing a desktop build with this change.
  Until the redeploy, a paid computer whose clock is more than five minutes off
  sees the clock error again, as it did before PR #1232, instead of a confirmed
  check-in. Check-ins on a correct clock work either way, and older apps keep
  working against the redeployed service.
- `LicenceClaims` gains an optional `refreshNonce`. The service README documents
  the request field and the claim.
- Tests: `services/desktop-licensing/refresh-nonce.test.mjs` (the signed echo, the
  signature over it, older apps, malformed nonces, revoked and released seats, the
  HTTP route) and `electron/licensing-refresh-nonce.test.ts` (a new nonce per
  request, replays from current and older services, a rewritten nonce, background
  refresh, nonce-free grants on a correct clock).
- This decision operates no machine and changes no output. Frame remains the sole
  ordinary Start gate.

### Since ADR-623 Amendment 2

A paid licence now has no check-in and ignores the clock, so the wrong-clock
offset this amendment guarded is gone: a paid grant is never held to the clock,
and no offset is saved. The nonce stays, for every refresh:

- A trial's refresh still counts as its check-in only when the grant signs back
  the nonce its request sent, so a replayed answer cannot push a trial's
  three-day check-in on.
- A paid refresh whose grant signs another nonce is refused and confirms
  nothing, so the next quiet check still asks the service. That is how a
  refund reaches a connected computer. A replayed grant from an older service
  that signs no nonce is accepted, which, like staying offline, only keeps a
  paid licence working as LightBurn's does.
