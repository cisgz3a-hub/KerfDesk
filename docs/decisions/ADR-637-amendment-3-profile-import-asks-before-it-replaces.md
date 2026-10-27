## ADR-637 Amendment 3 - A profile import asks before it replaces values, as a list choice does (2026-10-27)

**Status:** Accepted (rolling audit v4 finding H4-P2-1, confirmed by an independent refuter and
re-verified by the audit coordinator on main `105d6374c`; P3 H4-P3-1 handled with it; the
maintainer's standing instruction to fix confirmed audit findings). Extends Amendment 1 item 2 to
the Machine stage's profile import. | **Date:** 2026-10-27

### Context

The Machine stage has two profile imports: **Import KerfDesk profile** (`.lfmachine.json`) and
**Import LightBurn .lbdev**. Each one's **Apply imported profile** dispatched the same
`apply-preset` that a list choice dispatches. Unlike a list choice (Amendment 1 item 2), it asked
nothing first.

- **H4-P2-1 (P2).** In the repro, the draft was an Ortur Laser Master 3 with a clamp zone and a
  camera calibration. A LightBurn import left 0 zones and no calibration, with no question. The
  refuter's KerfDesk backup of the untuned machine did the same to a zone, a verified two-row
  scan-offset table and a saved position. The review cards list only what the file brings.
- **H4-P3-1 (P3).** A LightBurn driver whose name contains "grbl" is accepted as GRBL. That
  includes GRBL-LPC, which Creality's Falcon A1 Pro file names, GRBL-M3 and grblHAL. The import
  makes the profile stock GRBL with no vendor command set. The review said only "Mapped as
  GRBL-compatible".

### Decision

1. **Apply imported profile asks first** when the import would replace values someone set. It
   uses the same test as a list choice (`machineChoiceReplaces` on the import's `apply-preset`):
   max feed, S range, origin and homing, frame speed, no-go zones, scan-offset, camera or rotary
   calibration, saved positions, and a Laser + CNC machine's CNC values.
2. **It asks with the same question.** The question names what would be replaced, for example
   "Importing Ortur LM3 (vendor file) replaces the no-go zones, scan-offset calibration, camera
   calibration and saved positions set for the machine in this draft." It offers **Replace
   settings** and **Keep current settings**. Keep leaves the draft and the review card as they
   were. Replace applies the import and shows "Machine profile applied." The question is now one
   shared component (`ReplaceSettingsConfirm`), so the list and the import cannot drift apart.
3. **An import over a draft with nothing tuned applies at once,** as before.
4. **A LightBurn GRBL variant is flagged for review.** A driver other than plain "GRBL" adds a
   **Needs Review** row on the Controller. It says the profile was set up as stock GRBL with no
   vendor command set, and asks the operator to choose the machine from the list, or its firmware
   in Connection options, before the first job. The import is not mapped to a catalogue machine:
   a file's name and size do not establish its firmware (ADR-240 #2).

### Consequences

- A backup or a vendor file can no longer silently remove a no-go zone, a camera or scan-offset
  calibration, or saved positions from a draft. Save, as before, is still the only step that
  changes the project.
- A Falcon A1 Pro owner importing Creality's LightBurn file is told it is not set up with the
  Falcon commands.

### Verification

- `src/ui/laser/device-setup/DeviceSetupIdentifyStep.import.test.tsx` renders the real Machine
  stage. Both imports ask over a tuned draft. Keep keeps the zone, calibration and scan table, and
  shows no success toast. Replace applies. An untouched draft imports at once. With the change
  reverted, the two asking cases fail.
- `src/io/lightburn/lbdev-import.test.ts`: GRBL-LPC, GRBL-M3 and grblHAL get the review row, and
  plain GRBL does not.
- `DeviceSetupMachinePicker.customised.test.tsx` still passes on the shared question.
- This is code and test evidence only. No machine was used.
