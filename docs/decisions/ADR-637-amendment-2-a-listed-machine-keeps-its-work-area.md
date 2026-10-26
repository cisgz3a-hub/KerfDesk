## ADR-637 Amendment 2 - A listed machine keeps its work area when the controller is read (2026-10-23)

**Status:** Accepted (controller audit v4 E2 findings P2-1 and P3-1, confirmed by an independent
refuter and the audit coordinator; the maintainer's standing instruction to fix confirmed audit
findings). Amends ADR-420 rule 5 (what the automatic fill adopts) and ADR-637 Amendment 1 #1. |
**Date:** 2026-10-23

### Context

ADR-420 rule 5 has the automatic fill adopt "the mapped `$$` values", and GRBL's `$130`/`$131` map
to the profile's bed width and height. Rule 8 of the same ADR says those are "the controller's
travel limits, not the bed", but only for the catalog pick. ADR-637 Amendment 1 #1 kept a listed
machine's type from `$32`, because `$$` is a setting of the controller and not a measurement of the
machine (ADR-240 #2), but it did not protect the work area.

So a listed machine took the controller's travel as its bed. The Sculpfun S30's listed area is
380 × 385 mm from Sculpfun's product page, and its preset note says Sculpfun's firmware sets
`$130=400` / `$131=410`, which "can drive X into the frame". Choosing **Sculpfun S30** and then
connecting (or a later **Read again**) made the draft 400 × 410 mm while the S30 row stayed chosen.
No preset correction fired (that one matches the old 410 × 400 mm), and Job Review's travel fact
stopped warning, because `$130`/`$131` then matched the profile. GRBL's soft limits bound travel by
the same values, so a design placed between X 380 and 400 ran the head into the frame.

The fill card had a second flaw (P3-1): it diffed the draft from before the first fill against the
live draft, so a machine chosen after the fill had its catalog values listed under **Filled in from
your controller**, for example "Bed width: 400 mm → 430 mm" for an xTool D1 Pro whose controller had
reported 400.

### Decision

1. **A listed machine keeps its work area.** When the draft is a listed machine as the fill finds
   it (a chosen row, or a listed laser profile however edited, the same test as Amendment 1 #1),
   the fill leaves `bedWidth`/`bedHeight` out of the values it copies. Every other mapped value
   (max feed, S range, laser mode, Z travel, acceleration) is still copied as before. The draft
   still records what the controller reported, so Review's controller table keeps comparing
   `$130`/`$131` with the work area (they stay review-only and are never batch-written).
2. **The difference is shown, not applied.** When the controller's travel differs from the kept
   area, the fill card says **Work area kept at W × H mm**, as listed for the machine, and gives
   the controller's `$130 × $131` beside it. The operator changes the work area in Essentials only
   if the machine differs from the listed one (an extension kit, for example).
3. **A machine that is not listed is unchanged.** The untouched starter, **My machine isn't
   listed**, an imported profile and a draft filled earlier still take the reported travel as the
   bed, as ADR-420 rule 5 says.
4. **The card lists what the fill wrote.** The fill record keeps each value row as the latest fill
   to change it left it. The card lists a row only while the draft still holds that value, so a
   machine chosen afterwards never reads as reported. One **Undo** still restores the draft from
   before the first fill.
5. **Use detected values is unchanged.** It is the operator's explicit choice (ADR-347). It lists
   the work area as old → new and copies it when pressed.

No controller setting is written. Offering to write the listed area to `$130`/`$131` was
considered and left out: travel is machine-critical, Review keeps it review-only, and a write would
need its own consent flow with a re-read.

### Consequences

- A listed machine saved after connecting keeps its sourced bed, its row stays chosen with the
  values it describes, and Job Review's travel fact warns when `$130`/`$131` differ from it.
- A CNC preset now stays chosen after the fill, since its row is chosen while the draft has the
  preset's work area.

### Verification

- `device-setup-auto-fill.test.ts`: the S30 and a CNC preset keep their work area and stay chosen
  while the other values are copied; the fill-first order (starter filled, S30 chosen, read again)
  keeps 380 × 385 mm; the card rows leave out the work area a later choice replaced.
- `DeviceSetupWizard.detected-values.test.tsx`: in the rendered wizard, choosing the S30 and then
  connecting shows the kept-area note with the controller's 400 × 410 mm, no bed rows, the row
  still chosen, and 380 × 385 mm in Essentials.
- No hardware was operated.
