## ADR-592 Amendment 3 - The app stops sending and checking the refresh nonce (2026-10-23)

**Status:** Implemented in source; the app change takes effect at the next commercial desktop release (1.0.23). The Worker needs no change or redeploy | **Date:** 2026-10-23 | **Amends:** [ADR-592 Amendment 1](ADR-592-amendment-1-refresh-nonce.md) (refresh nonce), as already narrowed by [ADR-623 Amendment 2](ADR-623-amendment-2-paid-licences-keep-working-offline.md)

### Context

ADR-592 Amendment 1 (PR #1314, merged 2026-10-20) made every refresh send a random
`refreshNonce` and had the service sign it back. The app refused a grant that signed
any other nonce. Its purpose was to stop a saved refresh answer, replayed later
through a local proxy, from passing as a new paid check-in from a computer whose
clock was off.

ADR-623 Amendment 2 (PR #1317) then adopted LightBurn's model: a paid licence works
offline, and a paid grant is accepted whatever the clock says. Paid licences have no
check-in left to extend, and a refunded buyer who wants to keep Pro can simply stay
offline, which that model accepts. A trial grant is still held to the five-minute
clock tolerance, so a trial answer replayed more than five minutes after it was
issued fails that check without any nonce. A replay inside those five minutes gains
at most five minutes. The nonce no longer protects anything. The owner asked for
#1314 to be reverted on 2026-10-23.

The 2026-10-21 rolling licensing audit (finding 02-P3-1) had also found that
Amendment 1's trial guarantee was false as written. This amendment withdraws that
guarantee, which closes the finding.

### Decision

1. **The app sends no nonce.** A refresh sends only the seat's credentials (licence,
   activation, device and activation token), as before PR #1314. A background
   refresh no longer carries a nonce from its request to its reply.
2. **The app checks no nonce.** `verifyGrant` no longer refuses a grant whose signed
   `refreshNonce` differs from the one it sent, and `LicenceClaims` no longer names
   the claim. Claim verification ignores fields it does not check, so a grant with a
   `refreshNonce` claim still verifies. That covers a grant 1.0.21 or 1.0.22 saved on
   disk, and an answer from a Worker that still signs a nonce.
3. **The Worker keeps signing the nonce back.** `/v1/activations/refresh` still
   accepts an optional, well-formed `refreshNonce` and signs it into the grant.
   1.0.21 and 1.0.22 send one with every refresh. They refuse a grant whose signed
   nonce differs from the one they sent, and accept a grant without one. We chose to
   keep signing it, not to ignore it, because that is the safer option for those
   installed apps:
   - Nothing changes for them. They keep getting the answer they were built and
     tested against, whichever Worker build is live.
   - No redeploy is needed now. A Worker from before Amendment 1 ignores the field
     and signs nothing, which every app version accepts, so the release does not
     depend on the redeploy state.
   - Ignoring the field would change Worker code for no gain. A future change that
     validated the field less strictly, or copied a nonce into the wrong grant, could
     then make those apps refuse their own refreshes.

   Signing it costs nothing. The claim carries no rights, and from 1.0.23 no app
   reads it.

### Unchanged

ADR-623 Amendment 2 stays as it is: paid licences work offline with any clock;
trials keep their 3-day check-in and the five-minute clock tolerance; developer
licences are exempt. The Pro check still never gates Preview, estimates, Frame,
Start, Save G-code, a running job or machine control. This decision operates no
machine and changes no output.

### Consequences

- 1.0.23 and later accept a paid refresh grant whatever its clock, as ADR-623
  Amendment 2 intends. The answer from the service no longer has to echo a request
  value. Before this, a 1.0.22 refresh answered with another request's nonce
  (a Worker bug, or a cache in between) was refused with "Replayed entitlement".
- Retire the Worker's nonce signing only once 1.0.21 and 1.0.22 are no longer in
  use. Removing it then is safe too, because those versions accept a grant without
  a nonce.
- The service README states which versions send the nonce and why the Worker keeps
  signing it.
- Tests: `electron/licensing-refresh-nonce.test.ts` now checks that a refresh sends
  no nonce, that a paid licence saved by 1.0.22 with a signed nonce opens offline
  and refreshes, and that a trial refresh signing a nonce the app never sent is
  accepted. `services/desktop-licensing/refresh-nonce.test.mjs` keeps checking the
  Worker's signed echo for the installed apps.
