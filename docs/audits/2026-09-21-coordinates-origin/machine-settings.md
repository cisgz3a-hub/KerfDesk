# Machine settings, persistence and coordinate explanations

Audit base: `288ad66baf23e0c75c0a05f6216787577ddc6812`, isolated worktree
`D:\LaserForge\audit-coordinates-origin-20260921`. Findings below describe the
audited software and local repairs. They do not establish the user's physical
machine configuration, firmware build, homing switches, travel or axis direction.

## Result

The settings audit found one state defect and several misleading coordinate
explanations. The local repairs are complete. Final verification passed **29 test
files / 207 tests**. No controller was connected or commanded by this audit owner.

| ID | Finding and consequence | Local repair | Evidence |
| --- | --- | --- | --- |
| SS-01, P2 | Accepting a changed detected `$132` replaced Z travel but inherited `zTravelConfirmed=true`. A profile whose 75 mm travel had been checked became 150 mm and continued to enable laser focus jogging as though the replacement value had been checked. Both direct Apply and the setup wizard reproduced this. | The shared interactive profile patch clears inherited Z confirmation whenever the travel value changes. Unchanged travel retains its confirmation; an explicit fresh confirmation remains possible. This uses the existing focus-jog readiness rule and adds no Start policy gate. | `src/core/devices/device-profile-patch.ts:12`; `src/ui/laser/FocusJogControls.tsx:72`; two failures in `evidence/settings-regression-before.log`, both passing after repair. |
| SS-02, P2 | Home help always said `$H` and “all axes”. The Falcon A1 Pro driver actually homes X then Y with `$HX` and `$HY`; its Z command is separate. | Home help now uses the connected driver's exact command sequence, or the configured profile while disconnected, and distinguishes the machine reference from the workpiece origin. | `src/ui/laser/JobSetupControls.tsx:48`; `src/core/controllers/falcon-command-contract.ts:24`; fresh vendor configuration below. |
| SS-03, P2 | The machine-origin selector told users to match the homing corner. The separate homing-corner field reused that same wording, while the review said the Home command moved “toward” the selected value. In fact the recorded corner is descriptive metadata; it does not change firmware direction. | The UI distinguishes coordinate orientation from “Recorded home”, explains controller ownership of homing direction, and names `$23` only on the relevant GRBL configuration path. Bed help also distinguishes usable work area from configured `$130/$131` travel. | `src/ui/laser/DeviceProfileFields.tsx:30`; `src/ui/laser/device-setup/DeviceSetupConfirmStep.tsx:64`; `src/ui/laser/device-setup/DeviceSetupReviewStep.tsx:136`. |
| SS-04, P2 | Reset Origin claimed a return to machine zero. `G92.1` removes temporary XYZ offsets while any underlying saved G54 remains. Advanced persistent-origin help also implied all saved axes were changed, although the G10 commands name X and Y only. | Reset help/toast identify temporary offsets and retained G54. Advanced confirmation/help explicitly identify temporary XYZ versus saved G54 XY and warn that temporary Z zero must be established again. No command or button readiness changed. | `src/ui/laser/OriginRow.tsx:20`, `:101`, `:230`, `:312`; command sequence at `src/ui/state/origin-actions.ts:94`. Independent command/origin evidence is recorded by the origin audit owner. |

SS-01 concerns profiles with a manually confirmed powered Z travel. The shipped
Falcon A1 Pro preset uses its documented autofocus command and does not enable
generic powered Z jogging by default. This defect is not evidence that the user's
Falcon currently has an incorrect Z configuration.

## Settings coverage

| Setting or path | Verified software behaviour and limit |
| --- | --- |
| Bed width/height and workspace | Setup edits stay in the draft until Save. Replacement synchronises workspace dimensions. All five origin choices were round-tripped with unequal fractional bed dimensions through the store, `.lf2`, and `.lfmachine.json`. `$130/$131` are reported configured travel, not a physical measurement of usable work area. |
| Device origin | Front-left, front-right, rear-left, rear-right and centre persist. The choice affects coordinate transforms and operator-relative jog directions. It does not write firmware, Home the machine, move the head or establish a workpiece zero. Geometry/output parity belongs to the coordinate geometry audit. |
| Homing enabled and recorded corner | Both persist independently of device origin. `$22`, `$23`, `$27` and `$13` remain controller observations and are not silently converted into a software homing/origin choice by Use detected values. Recorded home does not configure actual homing direction. |
| Units | Profile distances and feeds remain mm and mm/min; project workspace uses mm. `$13` is retained separately as the controller's reporting-unit observation. The status-cache change-of-unit defect and repair are covered by the origin command audit, not inferred from these settings-parser tests. |
| Output maximum, Frame feed and controlled travel | Separate fields persist. The existing tests verify max-feed edits cannot leave optional controlled laser-off travel above that ceiling. Frame retains its separate request; final motion and live per-axis limiting are covered by the Frame/jog audit. |
| Z travel and powered Z | Manual travel edits already invalidated confirmation. The new regression closes the detected-apply route. The measured confirmation remains a user assertion, not proof from `$132`. CNC assumes its own powered Z workflow and keeps stock-top zero separate. |
| CNC Safe Z, stock and park | The setup UI writes machine Safe Z/park values and current-job stock dimensions/origin separately. Existing setup save, profile persistence, history and output-parity tests passed. A machine-profile export carries machine parameters; the complete project carries current-job stock. CNC transform/stock/park geometry belongs to the geometry audit. |
| Rotary | Type, diameter, motion per turn and reverse direction survive both profile and project round-trips. The model maps rotary travel onto Y; chuck scale uses machine motion per revolution divided by object circumference, while roller scale assumes already calibrated surface-mm travel. Physical calibration and rotary geometry qualification remain separate. |
| No-go areas | Distinct rectangle coordinates, dimensions and enabled state round-trip. Their motion interpretation and warning-only Frame/Start policy are checked by the other audit scopes. |
| Laser/CNC modes | Shared device geometry stays separate from the current CNC machine/job record. In CNC mode, accepting detected values excludes hidden laser `$30/$31/$32` fields and only maps a detected spindle S scale to RPM when explicitly chosen. Existing hybrid setup and retained-CNC tests passed. |
| Save, history, export/import | Existing tests plus the independent five-origin matrix cover atomic setup Save, cancellation/draft ownership, Undo, `.lf2`, machine-profile export/import, optional camera/rotary fields and vendor command-set retention. These are file/model tests; browser reload and actual user profile evidence are reported separately by the primary audit. |
| Firmware writes | Reading/applying detected values does not itself write firmware. General GRBL setup can separately queue explicitly selected supported output-setting writes. Geometry and recorded homing-corner fields do not become firmware writes. The Falcon A1 Pro vendor command set exposes no automatic settings read/write path. |

## Falcon preset check against a fresh primary source

The final model focus is **Falcon A1 Pro 20W**, inferred from the user's
clarification “20w pro” and the matching [official Creality product](https://www.creality.com/products/falcon-a1-pro-20w).
The user did not explicitly type “A1”; the inspected browser tabs show a
disconnected generic 400 × 400 profile, so a live saved A1 Pro configuration is
still unverified. The catalogue contains two distinct choices:

| Profile | Software defaults and meaning |
| --- | --- |
| Creality Falcon A1 Pro, vendor command set | X358 × Y268 mm, 115200 baud, S1000, front-left coordinate orientation, Home initially disabled, requested output/Frame feed 10000 mm/min, `$HX` then `$HY` Home, `$HZ1` autofocus. Settings fetch and native `$J` are disabled by the vendor command contract. |
| Creality Falcon-compatible GRBL diode | A generic 400 × 400 mm GRBL fallback, front-left orientation and Home initially disabled. Its evidence note expressly says the size does not identify a Falcon model. A1, A1 Pro, Falcon2 and Falcon2 Pro are not interchangeable profiles. |

The exact shipped A1 Pro software profile is:

| Setting | Shipped value | Meaning or evidence limit |
| --- | --- | --- |
| Profile name | Creality Falcon A1 Pro (vendor command set) | Specific catalogue choice; distinct from the broad Falcon-compatible fallback. |
| Bed X / Y | 358 / 268 mm | Explicit vendor device-file Width / Height, rather than guessing dimension order from advertising. |
| Device origin | Front left | Software coordinate orientation; physical agreement still needs checking. |
| Homing enabled / recorded home | Off / front left | Off is the preset's initial local Home policy, not a claim that this machine cannot Home. Recorded home does not change firmware. |
| Home command when enabled | `$HX`, then `$HY` | X/Y sequence; each command is acknowledged separately. It does not run the separate Z Home macro. |
| Auto-focus | `$HZ1` | Vendor autofocus macro; separate from Home and Set origin here. |
| Controller selection | grblHAL with `creality-falcon-a1-pro` command overrides | The vendor file labels the device GRBL-LPC; this selection is a compatibility configuration, not independent firmware identification. |
| Serial baud | 115200 | Vendor device-file value. |
| Output max / requested Frame feed | 10000 / 10000 mm/min | Software requests, not measured physical speed limits. |
| Power S range / laser mode | 0–1000 / enabled | Saved output model, not a live settings read. |
| Air output | M8, unreliable restart flag enabled | Saved vendor-specific air policy. Physical pump behaviour is outside this audit. |
| Streaming | Character counted, 1024-byte requested window | Runtime capacity bounding belongs to the transport audit. |
| Generic powered Z jog | Not enabled by this preset | The documented autofocus workflow does not establish generic Z-jog travel/clearance. |
| Rotary / no-go areas | No active rotary setup / empty list | Optional configuration, not a statement about attached hardware or clamps. |

Freshly retrieved the [Creality vendor LightBurn bundle](https://wiki.creality.com/falcon_a1_pro_(lightburn_2.0.00+).lbzip)
from the [A1 Pro LightBurn guide](https://wiki.creality.com/en/laser-engraver/falcon-a1-pro/lightburn-guide).
SHA-256 is `11b13328ace21461c7cba2e6350999813fb60a670b3cff77930f0a44f988405b`,
matching the repository's earlier source capture. Selected current source fields,
including explicit Width/Height, mirror flags and macros, are saved in
`evidence/settings-falcon-vendor-current.json`.

That vendor file labels the device GRBL-LPC; it does not independently prove the
exact firmware family/build of the user's machine. The preset's front-left
orientation, feed requests and homing policy are software configuration choices,
not physical qualification. The generic 400 × 400 fallback is intentionally
generic and is not classified as a defect merely because another Falcon has a
smaller work area.

The current LightBurn importer explicitly rejects `.lbzip` and accepts a bounded
legacy `.lbdev` text format. The modern vendor bundle is primary research evidence
for the built-in A1 Pro choice, not a demonstrated user import workflow.

## Verification record

- Baseline: `evidence/settings-core-ui-tests.log`, 23 files / 161 passing tests.
- Independent desired-behaviour reproduction: `evidence/settings-regression-before.log`,
  2 failures / 7 passes. Both failures concern inherited Z confirmation after a
  changed detected travel.
- Initial repair verification: `evidence/settings-repair-tests.log`, 8 files / 78 passes.
- Final verification after all settings and origin-help edits:
  `evidence/settings-final-tests.log` and `evidence/settings-final-tests.json`,
  **29 files / 207 passes, zero failures**.
- Exact tested file list: `evidence/settings-final-file-list.json`. JSON reporter
  `numTotalTestSuites` includes nested describe groups; the file count is
  `testResults.length`.
- New substantive tests: `src/ui/laser/device-setup/machine-settings-coordinate-audit-20260921.test.tsx`.
  Tests cover all five origin round-trips, separation of controller observations,
  both detected-Z update routes, unchanged confirmation and explicit new confirmation.
- Text corrections were reviewed against the actual driver/command source and
  existing UI suites. No new tests mirror the wording.

All Vitest runs used `node node_modules/vitest/vitest.mjs run ... --maxWorkers=1`.
The final run also used `--reporter=default --reporter=json` with the JSON output
path above. Shared type/lint/static integration verification is owned by the
primary audit. This owner changed no package/dependency, public deployment, user
profile, firmware setting or hardware state.
