# PR integration supplement — 2026-09-22

The branch integrated main through `9d72ba798` at merge commit
`ef151088b45a119e5dc9d192fed2e07493c950a2`. The original **805-control / 91-command**
inventory and verdict matrices remain dated evidence. Their verdicts do **not** automatically
apply to newly inherited controls or changed implementations.

The separate [integration inventory](pr-integration-source/buttons.json) records **815 source
control definitions and 94 command IDs**, scanning 2,635 source files. Its SHA-256 of scanned
paths and contents is `c4256ab394fe578f8391e0df5346e8eb4bc6b4ac1f4f60a5a81d5a16ee9b5e29`.
The corpus includes helper modules and excludes named test/spec files and fixtures, as described
in the inventory. These are source definitions and call sites, not visible button counts.

## What changed

The [control delta](pr-integration-control-delta.json) preserves the old-to-current source
locations and exact changed-file list. It reconciles 796 unchanged catalogue signatures,
nine old definitions replaced by eight current definitions, and eleven newly catalogued
definitions: **nine disclosures, Browse all/Show fewer profiles, and the hybrid active-toolhead
radio**. This is a net increase of ten. Unchanged signatures are not fresh runtime passes.

The setup changes are in `src/ui/laser/device-setup/`:

| Current source file | Changed control definitions |
| --- | --- |
| `DeviceSetupConfirmStep.tsx` | Travel speeds disclosure |
| `DeviceSetupIdentifyStep.tsx` | Controller and connection settings disclosure |
| `DeviceSetupMachineCapability.tsx` | Redesigned machine choices and hybrid active-toolhead radios |
| `DeviceSetupMachineStep.tsx` | Air assist and test fire disclosure |
| `DeviceSetupProfilePicker.tsx` | Browse all/Show fewer, Use/Selected profile, Profile details |
| `DeviceSetupReviewSections.tsx` | Named Edit cards replace the two old Review Edit implementations |
| `DeviceSetupReviewStep.tsx` | Controller settings and hardware-checklist disclosures |
| `DeviceSetupShell.tsx` | Three-stage stepper, Cancel, Back, Save and forward navigation, moved from `DeviceSetupWizard.tsx` |
| `DeviceSetupStages.tsx` | Connect and detect, CNC job setup, Accessories and calibration disclosures |

`DeviceSetupCncReview.tsx` and `DeviceSetupWizard.tsx` lose the superseded implementations.
`ConnectedMachineProfile.tsx`, mounted by `ControllerConnectionControls.tsx`, adds a read-only
connected profile summary, not an action control. The delta JSON lists related state, styling,
help, tutorial and other source changes as well.

Three command IDs were added under Window → Appearance:
`window.theme-light`, `window.theme-dark`, and `window.theme-system`. They reuse the existing
`AppMenuBar.tsx` menu-item definition; no separate Appearance button definition was added.

The primary toolbar now includes **Import Image**, subject to available width. **Image Studio
always stays in More** and Tools → Image, including when an image is selected; Trace remains
eligible for the primary toolbar with an image selection. `TOOLBAR_GROUPS` now contains 17
commands. The historical shell matrix's two AppMenuBar expectations stating “91 registered
commands” describe the dated audit. Its generic toolbar dispatch assertions remain useful, but
the old primary Image Studio placement and 16-command count are superseded.

## Targeted integration evidence

The first [integration unit report](pr-integration-menu-vitest.json) passes **160/160 cases**
across 11 files. It preceded the final machine-setup merge, so its older machine cases do not
prove the replacement setup. Its unchanged menu and toolbar paths include:

- `AppMenuBar.control-audit.test.tsx`: 94 actual menu-command clicks plus exact registry
  accounting. Each new Appearance case asserts exactly one `setAppTheme` call with its own
  `light`, `dark` or `system` argument and no unrelated callback. These are callback boundaries.
- `Toolbar.overflow.test.tsx`: the primary file workflow, Image Studio staying in More, image
  selection, responsive movement, disabled actions, dispatch and focus restoration.
- `Toolbar.icons.test.tsx`: all 17 toolbar commands have an icon and accessible name, without
  duplicated command instances when More is open.

[Chromium integration checks](pr-integration-browser.json) pass **10/10 cases** on the final
merged source: material-wizard persistence, image-layer availability, routine machine/help
controls, completed-job Done preserving the project, and six workspace checks.

The [compiled-app browser report](pr-integration-production-browser.json) passes **5/5 cases**.
Its two `workspace-responsive.e2e.ts` cases distinguish the Appearance paths precisely:

- **“opens light on a dark desktop, and Window > Appearance reaches dark”** clicks Dark and
  Light through the actual menu and checks workspace canvas brightness after each choice.
- **“Match System follows the desktop, including live theme changes”** starts with a stored
  `system` preference, then checks dark rendering, matching menu styling, and a live OS change
  to light. It does not click Match System; that menu dispatch is checked by the unit case above.

The [current machine report](pr-integration-machine-vitest.json) contains **68/68 latest
passing cases across nine files**. This is an aggregate of the latest executed result for each
unique case, not one clean 68-case run. Each assertion identifies its raw `sourceReport`;
earlier attempts, including their failures, remain available.

Five specifically cited cases cover the 19 changed setup definitions in
[the control delta](pr-integration-control-delta.json): **18 verified software behaviours and
one verified callback boundary**.

| Current definitions | Executed outcome |
| --- | --- |
| Five stepper/footer definitions | All three destinations, both forward actions and Back; retained draft name; Save adds one undo entry and closes; a later Cancel discards its edit without homing or controller writes |
| Eight stage/review disclosures | Each named section opens and closes in the real hybrid CNC dialog; the live project stays unchanged and no writes are queued |
| Two machine/active-mode radio definitions | All three capability choices and both active modes update the real setup reducer, leaving the live project unchanged |
| Three profile definitions | Browse all/Show fewer changes the visible list; every rendered Profile details opens and closes; Use updates the chosen draft name and Selected is disabled |
| One shared Review Edit definition | Five named CNC-fixture cards dispatch exactly their expected setup routes; the dispatch is mocked |

The exact file, case, raw report, assertions and limits are recorded per definition. Availability
expressions remain source-reviewed unless an assertion is explicitly identified. The new cases
do not cover every saving/invalid/queued-write state, complete profile equality, or every
machine-kind variation. In particular, the laser-only Review Edit binding and queued-write
auto-expansion are source-reviewed, not new runtime passes. Opening a section does not re-prove
every child action. The three new Appearance commands also have individual boundary evidence
in the delta. Historical cases and matching source signatures alone do not support new verdicts.

No real controller, camera, printer, laser, spindle or material action was performed. Browser
and local/simulated state checks do not qualify physical setup or hardware output. Build and
repository checks are recorded in [verification.md](verification.md).

The first hosted browser gate and its test-fixture corrections are recorded separately in
[the PR follow-up](pr-ci-followup.md), including the unsuccessful local Sharp performance check.

## Reproduction without changing dated evidence

```sh
node docs/audits/2026-09-21-interface/inventory-buttons.mjs docs/audits/2026-09-21-interface/pr-integration-source
node docs/audits/2026-09-21-interface/build-command-control-audit.mjs --check
```

The command builder validates every one of the 91 baseline IDs and its retained passing case
against the current independent expectations, reports the three current-only IDs, and writes
no historical output in `--check` mode. Missing baseline expectations still fail validation.
