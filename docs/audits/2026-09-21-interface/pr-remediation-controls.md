# Controls after the remediation merge — 2026-09-22

Main `39eebb6fcb723a2e51f9866a7c0c7dedf396b981` (PR #826) was integrated at
`9d05cc626cee59187370b16d31095f257de8cb2e`. The earlier
[817-control tutorial snapshot](pr-final-source/buttons.json) remains unchanged and dated.

A fresh temporary scan still finds **817 control definitions and 94 command IDs** across
**2,641 source files**, with no added or removed definitions or commands. Its SHA-256 is
`6c2a4a8e2db18672807546a0d7d57db7102821eb372478675ce998835d3c7635`.
The full generated inventory is kept only in ignored `artifacts/pr-publication/source-remediation`.
The compact [delta JSON](pr-remediation-control-delta.json) preserves the count, digest, affected
records, exact 67-file upstream change list and passing evidence references.

All 817 catalogue signatures match the prior snapshot. **That does not mean behaviour is
unchanged:** these two UI changes occur in parent visibility rules, which the direct-control
signatures do not resolve. There are three affected catalogue records because Release motors
has both a native definition and a reusable component call site.

| Affected record | Changed behaviour | Fresh evidence |
| --- | --- | --- |
| `OriginRow.tsx:88` — Release motors | The parent now uses an XY origin, rather than any X/Y/Z offset, to decide whether the row owns this action. | Three actual combined-rail cases assert exactly one Release control with no origin, a Z-only offset, and a settled XY origin. A separate click case checks cancel, approval and streaming-disabled behaviour against a store-action spy. |
| `OriginRow.tsx:177` — `ReleaseMotorsButton` call site | Passes `canSleep && (homingEnabled || hasCustomXy)` instead of the Z-inclusive predicate. | Same combined-rail and confirmation cases; this call site is not a second independently visible button. |
| `DeviceSetupIdentifyStep.tsx:236` — Worker streaming checkbox | Its parent now restricts it to GRBL, grblHAL and FluidNC. It is hidden for Marlin and Smoothieware. | The actual wizard toggles the preference and switches through all five firmware choices, retaining the draft opt-in. A separate Identify case checks the exact draft patch and unchanged live project preference. |

The [machine report](pr-remediation-machine-vitest.json) records **132/132 passed across 15
files**, with zero failed or skipped. Six specifically cited cases support the three records:
**two verified boundary records and one verified software behaviour record**. The row/guide
visibility checks render real components; Release execution stops at a mocked store action.
The worker wizard case does not Save the profile or open a serial session, despite “saved
preference” appearing in its test title. The detailed boundaries are recorded per case in JSON.

The separate [completion/eligibility report](pr-remediation-machine-completion-vitest.json)
has **8 passed, zero failed, one previously exercised simulator case filtered**. Seven new
transport-eligibility cases check exact connection options: Marlin and Smoothieware ignore
the worker opt-in; GRBL, grblHAL, FluidNC and the default driver retain it; opting out uses
ordinary transport. The real connect action reaches a mocked `port.open` that throws before
a serial session starts. These are transport-selection boundary checks, not hardware results.
The remaining new case verifies Done after an unknown-dwell simulated run settles and belongs
to the wider machine audit. The two reports contain 140 distinct executed passes; only 13
specific cases are cited as evidence for the affected controls in this supplement.

The other inherited changes include transport, autosave, tracing, preview and job preparation.
This compact supplement does not revalidate every downstream effect of all unchanged controls;
broader integration results are maintained in [verification.md](verification.md). No hardware
was operated, and no production or test source was edited for this source-delta subtask.

To reproduce the temporary source inventory without overwriting a dated snapshot:

```sh
node docs/audits/2026-09-21-interface/inventory-buttons.mjs artifacts/pr-publication/source-remediation
```
