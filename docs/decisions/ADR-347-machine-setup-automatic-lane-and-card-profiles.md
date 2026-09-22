## ADR-347 - Machine Setup leads with what the controller already reported, and a profile is chosen by its whole card (2026-09-22)

**Status:** Accepted. | **Date:** 2026-09-22

Maintainer direction, 2026-09-22, with a screenshot of the profile card: machine
setup should be mostly automatic, and choosing a profile should not depend on a
small button — the whole block should choose it.

Amends the page composition of ADR-240 (as amended 2026-09-21). The explicit
application of controller readback (ADR-205), the "generic `$$` values never
establish hardware identity" ceiling of ADR-240 #2, the single atomic draft and
Save/Cancel boundary, per-setting firmware consent, and all Frame/Start
behaviour are unchanged.

### Context

Two separate frictions, both in stage 1.

**The automatic part was already happening, out of sight.** Connecting runs the
controller handshake, which fires that family's settings query and publishes a
mapped `Partial<DeviceProfile>` into the laser store. By the time Machine Setup
opens on a connected machine, the work area, feed ceiling, power scale and laser
mode have usually all been read. The operator could not see any of it: the
readback list and the one action that copies it into the draft lived inside
**Connect and detect**, a `<details>` that is closed unless the operator arrived
by the `connect` deep link. So the surface read as "fill this in yourself", and
the values it had already fetched sat one unprompted click away.

**The profile card advertised a target it did not need.** The card rendered its
name, size, evidence badges and a `Profile details` disclosure, and put the
actual choice in an 11px `Use profile` button in the top-right corner. Every
other part of a 300px-wide block was inert. Directly above it, the machine-type
cards are `<label>`s wrapping a radio, where the whole card is the target — so
the same page taught two different rules for "choose one of these".

### Decision

1. **A `Set up automatically` lane opens the Machine stage**, between the
   machine-type cards and the catalog. It states what the selected controller
   family reported, lists the mapped values, and carries the existing
   **Use detected values** action. It is the only place that action appears;
   Connect and detect keeps connecting, the read-only checks, the
   driver-mismatch alert and the command contract.
2. **Detection still never applies itself.** The lane makes one explicit click
   sufficient; it does not make it automatic. ADR-205's separation of
   observation from draft is intact, `$30` still becomes spindle RPM only
   through the explicit CNC option, and nothing reaches the project before Save.
3. **Disconnected is a state of the same lane**, not a missing one: it says that
   connecting the controller below will read those values into the draft, and
   that offline setup remains supported. A file-only controller renders no lane,
   because it answers no read.
4. **A catalog profile is one option in a radio group.** The card body is a
   `<label>` — name, size, confidence badges, warning — so a pointer anywhere on
   it chooses that profile, and the group is one tab stop with arrow-key
   movement. `Profile details` stays **outside** the label, so opening the
   evidence never selects the machine. The radio keeps the accessible name
   `Use <profile name>`.
5. **Selected state is the radio plus the card tint**, replacing the disabled
   `Selected` button. Re-choosing the current profile is a no-op, as before.

### Consequences

- An operator with a connected machine sees the machine's own numbers on the
  first screen and adopts them in one click, instead of discovering them by
  opening a disclosure they had no reason to open.
- `DeviceSetupConnectStep` no longer renders `DetectedReadback`,
  `DeviceSetupDetectedApply`, or the applied-confirmation status; those moved to
  `DeviceSetupAutoDetect`. Tests and e2e that located them inside the disclosure
  still find them in the dialog.
- Locators that clicked a `button` named `Use <profile>` now target a `radio`
  with the same accessible name. `DeviceSetupWizard.catalog.test.tsx`,
  `MachineSetupStages.audit.test.tsx`, `LaserWindow.device-setup.test.tsx` and
  `production-workflows.spec.ts` are updated in this change.
- WORKFLOW.md F-C7 stage 1 and the `machine-setup` tutorial describe the lane.
- The dead standalone `ProfileCatalogPanel` in `MachineSetupProfiles.tsx` keeps
  its old card shape. It is referenced only by its own test; folding or deleting
  it remains the separate refactor ADR-240 already deferred.
