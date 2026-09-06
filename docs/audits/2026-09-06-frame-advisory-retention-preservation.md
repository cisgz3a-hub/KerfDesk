# Frame advisory-retention preservation, 2026-09-06

This publication adopts only the independently reproduced portions of the historical
`agent/frame-start-advisory-retention` donor at `de36b8674a8abf0c9276f5666ae34e14a3791476`
(`C:/Users/Asus/LaserForge/continuous-audit-source`). Its original dirty files remain preserved.
The publication base is main `00abb56e151332a85d9f9673ed6a5e0fae3faaef`.

## Adopted scope

Equivalent controller settings/build-info refreshes and observation timestamps no longer
revoke an otherwise clean Frame. Report-unit interpretation remains bound even when position
and WCO are zero. Session, WCO, origin, trusted-position, work-Z, return and terminal
settlement checks remain in place. The later Start handoff is unchanged.

Exactly six descriptive profile fields are excluded from the artifact retention signature:
`name`, `vendor`, `model`, `profileSource`, `catalogVersion` and `evidence`. Every other field,
including unknown future fields, `noGoZones` and both time calibration factors, remains bound.
This concerns ordinary prepared Start output; optional export provenance comments can still
change when a profile is renamed. Cached plans and Job Review's warning loop are unchanged.

## Preserved proposals, pending and unapplied

The donor's literal removal of all settings comparisons would also admit a `reportInches`
change with zero position and WCO. Zero normalizes identically in either unit. That broader
interpretation change is not adopted by the equivalent-refresh fix.

The donor also excluded `noGoZones`, `estimateCutTimeScale` and `estimateTravelTimeScale`.
Those exclusions remain **pending and unapplied**. Equal G-code, route and Frame perimeter
do not establish consistent cached timing or current review warnings:

- Fresh main preparation with an overlapping clamp added a no-go warning without changing
  motion. An external diagnostic applying the donor key exclusions to current review code
  retained the permit, showed the cached initial warning model, then rebuilt the clamp warning
  on the first Confirm. The review remained pending until a second affirmative Confirm. This
  observed two-confirm warning flow is evidence for a separate review-refresh proposal, not
  an adopted no-go exclusion or proof for every retained-artifact consumer.
- [PR755](https://github.com/cisgz3a-hub/KerfDesk/pull/755) added saved calibration to retained
  live timing. In the current-main probe, changing both factors increased the live plan from
  **11.7925 s to 31.3276 s** with identical G-code and timing validator evidence. Under the
  external donor-key diagnostic, review refreshed to a 33 s pre-run estimate while the retained
  candidate still held the 11.7925 s live plan. Current main expires that permit; the stale-plan
  inconsistency is counterfactual evidence against adopting the historical exclusion unchanged.

## Original donor paths

| Original path | Disposition in this publication |
| --- | --- |
| `src/ui/state/framed-run.ts` | Ported narrowly; literal all-settings deletion superseded by semantic report-unit equality |
| `src/ui/state/framed-run.test.ts` | Ported with expanded equivalent-refresh, factual and zero/nonzero unit coverage |
| `src/ui/state/laser-store-frame-advisory-refresh.test.ts` | Ported using the maintained in-memory handshake/lifecycle helper and terminal-settlement assertions |
| `src/ui/state/canvas-motion-plan.ts` | Six descriptive exclusions ported; no-go/timing exclusions preserved as pending proposals |
| `src/ui/state/canvas-motion-plan.test.ts` | Ported as retained-field/output/future-field coverage; original combined nine-field assertion superseded |
| `src/ui/laser/framed-run-device-metadata-retention.test.ts` | Metadata portion ported per field with byte/route/metric/timing evidence; combined no-go acceptance preserved as a pending proposal |
| `docs/audits/2026-07-26-kerfdesk-electron-desktop-quality-audit.md` | Superseded as current evidence; qualified historical report already preserved in PR754 |
| `docs/audits/2026-07-26-start-authorization-hidden-blocker-audit.md` | Superseded as current evidence; qualified historical report already preserved in PR754 |
| `docs/audits/2026-07-26-start-authorization-progress-ledger.md` | Superseded as current evidence; qualified historical report already preserved in PR754 |
| `AGENTS.md` | Preserved excluded instruction proposal; not ported |
| `CLAUDE.md` | Preserved excluded instruction proposal; not ported |

The pre-publication review ran 39 distinct focused current-source and external diagnostic
cases. Its initial harness corrections and all counterfactual results remain recorded in the
external commit/PR monitor evidence. These are software/mock observations, not controller,
material or hardware qualification. The dated July tests are historical evidence, not proof
of the current publication. No hardware or deployment forms part of this work.
