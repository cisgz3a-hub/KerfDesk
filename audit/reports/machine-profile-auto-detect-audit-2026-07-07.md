# Machine Profile / Auto-Detect Audit - 2026-07-07

Scope: read-only audit of the built-in laser/CAM machine profile catalog, controller auto-detect, setup-wizard profile application, Machine Setup catalog application, and the current automated tests that prove or do not prove profile behavior.

Original commit audited: `0053665 Preserve detected motion settings for catalog profiles`

## Current-Main Refresh - 2026-07-07

Current commit audited: `c3149c9 fix: allow numeric fields to clear while editing`

Audit mode: read-only. No source fixes were made.

### Pass 1 - Catalog and Detection Contracts

Files inspected:

- `src/core/devices/profile-catalog.ts`
- `src/core/devices/device-profile.ts`
- `src/core/controllers/detect-controller.ts`
- `src/core/controllers/grbl/parse-settings.ts`
- `src/core/devices/profile-catalog.test.ts`

Result:

- The catalog still validates structurally, but it is not a machine-identification system.
- `detectControllerFromBanner(...)` still detects firmware family only: `grbl-v1.1`, `grblhal`, `fluidnc`, `marlin`, or `smoothieware`.
- `settingsMapToProfilePatch(...)` still extracts controller facts from `$$` (`$30/$31/$32`, `$110/$111`, `$120/$121`, `$130/$131`, `$132`) but cannot identify a vendor/model.
- There is still no pure profile suggestion/scoring layer that can rank "Falcon A1 Pro" above "generic grblHAL" from `grblHAL + 400x400 + S1000`.
- Catalog evidence statuses are still coarse: `default`, `researched`, `user-imported`, `unverified`. They do not map to operator-facing confidence labels such as `Hardware verified`, `Simulator tested`, `Public-spec starter`, `Experimental`, and `Default starter`.
- `creality-falcon-a1-pro-compatible` remains a broad fallback profile and still does not set `controllerKind: 'grblhal'`.

Finding status:

- **Still open:** add safe suggestion layer instead of silent auto-selection.
- **Still open:** add clearer profile confidence labels.
- **Still open:** add a specific `Creality Falcon A1 Pro (grblHAL)` profile while keeping the old compatible ID loadable.

### Pass 2 - Setup/Profile Apply Paths

Files inspected:

- `src/ui/laser/MachineSetupProfiles.tsx`
- `src/ui/laser/MachineSetupDialog.test.tsx`
- `src/ui/laser/device-setup/device-setup-flow.ts`
- `src/ui/laser/device-setup/DeviceSetupWizard.tsx`
- `src/ui/laser/device-setup/device-setup-flow.test.ts`
- `src/ui/laser/device-setup/DeviceSetupWizard.test.tsx`
- `src/ui/laser/MachineSetupImportExport.tsx`

Result:

- **Machine Setup catalog path is now good for the reported slow-framing bug class.** It reads `detectedControllerKind`, `controllerSettings`, `detectedSettings`, `current`, and `lastSettingsReadAt`, then applies `catalogProfileWithControllerFacts(...)`.
- That helper preserves controller-read facts and, when settings have been read, preserves the current `framingFeedMmPerMin`. This is covered by `MachineSetupDialog.test.tsx` line 117: "keeps controller-tuned motion settings when applying a catalog profile after auto-detect".
- **Guided Device Setup is still weaker.** `DeviceSetupWizard.tsx` reads `detectedSettings` and `lastSettingsReadAt`, but not `detectedControllerKind`.
- The reducer applies a preset as `{ ...action.profile, ...state.detected }`. That preserves detected numeric fields, but not detected firmware identity, and not the current framing feed unless it is explicitly present in `detected`.
- GRBL settings parsing does not derive `framingFeedMmPerMin`; it derives `maxFeed`. Therefore, guided setup can still reset frame feed to the selected profile's default.
- Import/export applies imported KerfDesk or LightBurn profiles raw with `replaceDeviceProfile(profile)`. That may be intended for import review, but it does not follow the "controller facts stay authoritative" rule when a machine is already connected and detected.

Finding status:

- **Partially fixed:** Machine Setup catalog profile application preserves live controller facts and frame feed.
- **Still open:** Device Setup wizard should preserve `detectedControllerKind` and current/controller-tuned frame feed when applying a preset after detection.
- **Still open / product decision:** imported profiles should either preserve controller-read facts when connected or warn clearly that import replaces them.

### Pass 3 - Framing Motion, Air Assist, and Test Proof

Files inspected:

- `src/ui/laser/use-frame-action.ts`
- `src/ui/state/laser-store.ts`
- `src/core/controllers/grbl/frame-lines.ts`
- `src/core/controllers/grbl/commands.ts`
- `src/core/controllers/grbl/driver.ts`
- `src/core/controllers/marlin/commands.ts`
- `src/core/controllers/smoothieware/commands.ts`
- `src/ui/state/laser-store-motion-operation.test.ts`
- `src/ui/laser/start-frame-raster-budget.test.tsx`
- `src/ui/laser/JogPad.test.tsx`
- `src/ui/state/laser-store-air-assist-safety.test.ts`
- `src/core/output/grbl-strategy-air-assist.test.ts`

Result:

- Frame feed is selected at `use-frame-action.ts:102` as `Math.min(project.device.framingFeedMmPerMin, project.device.maxFeed)`.
- The store then calls `refs.driver.commands.buildFrameLines(bounds, feed)`.
- GRBL framing emits five absolute `$J=G90 G21 ... F...` perimeter moves and clamps feed to at least `F1`.
- Frame lifecycle coverage is good: tests prove one-leg-at-a-time dispatch, CNC safe-Z retract before XY frame legs, cancel behavior, and controller-error safety notice behavior.
- Air assist behavior is safer after recent work: the jog-side button is visible/clickable, setup-needed flow is covered, manual on is blocked when `airAssistCommand` is `none`, and job output does not emit coolant commands while device air output is disabled.
- The remaining air-assist gap is mostly wording/modeling: profile capability `air-assist` still means "machine supports hardware" while `airAssistCommand` means "software will emit M7/M8." The UI should keep those concepts visibly separate.

Finding status:

- **No confirmed defect in frame G-code emission.** The slow/weird framing behavior is upstream profile state selection, not the frame driver bytes.
- **Still open:** Device Setup/import can still swap frame-feed/controller identity facts in ways Machine Setup now avoids.
- **Partially fixed:** air-assist manual override is tested and safer; confidence/capability wording still needs hardening.

### Targeted Verification

Command run:

```powershell
pnpm exec vitest run src/core/devices/profile-catalog.test.ts src/core/devices/device-profile.test.ts src/core/devices/gcode-dialects.test.ts src/core/controllers/grbl-family-drivers.test.ts src/core/controllers/detect-controller.test.ts src/core/controllers/grbl/parse-settings.test.ts src/core/controllers/grbl/driver.test.ts src/core/controllers/grbl/commands.test.ts src/core/output/grbl-strategy.test.ts src/core/output/grbl-strategy-machine-compatibility.test.ts src/core/output/grbl-strategy-air-assist.test.ts src/core/output/marlin-strategy.test.ts src/core/output/smoothieware-strategy.test.ts src/core/controllers/ruida/ruida.test.ts src/ui/laser/device-setup/device-setup-flow.test.ts src/ui/laser/device-setup/DeviceSetupWizard.test.tsx src/ui/laser/MachineSetupDialog.test.tsx src/ui/laser/start-frame-raster-budget.test.tsx src/ui/state/laser-store-motion-operation.test.ts src/ui/state/laser-store-air-assist-safety.test.ts src/ui/laser/JogPad.test.tsx
```

Result: **21 test files passed, 188 tests passed.**

Residual test hygiene: existing React `act(...)` warning remains in `DeviceSetupWizard.test.tsx`; the suite still exits 0.

### Current Findings

#### P1 - Guided Device Setup still does not preserve detected firmware identity

Evidence: `DeviceSetupWizard.tsx` reads `detectedSettings` and `lastSettingsReadAt`, but not `detectedControllerKind`. `device-setup-flow.ts` overlays only `state.detected` when applying a preset.

Impact: a Falcon A1 Pro detected as `grblhal` can still commit a Falcon-compatible preset without preserving the detected `grblhal` identity in this setup path.

#### P1 - Guided Device Setup can still reset frame feed to profile defaults

Evidence: frame feed comes from `project.device.framingFeedMmPerMin`; `settingsMapToProfilePatch(...)` does not derive `framingFeedMmPerMin`; the wizard preset path overlays detected numeric settings but not current frame feed.

Impact: this is the remaining setup-path version of the "profile makes framing slow/confused" complaint. Machine Setup catalog is covered; guided setup is not.

#### P1 - No profile suggestion/scoring layer exists

Evidence: controller detection and settings parsing are separate primitives; no code path produces ranked `suggested` / `possible` / `manual-only` machine profile candidates.

Impact: the app cannot safely suggest Falcon A1 Pro from detected grblHAL facts and cannot explain why a generic profile is merely possible.

#### P2 - Profile confidence labels are not truthful enough for operators

Evidence: `ProfileEvidenceStatus` remains `default | researched | user-imported | unverified`; profile cards show `profileSource` rather than proof level.

Impact: users can read all built-in profiles as equally trustworthy even though some are hardware-verified, some are simulator-tested, and others are public-spec starters.

#### P2 - Falcon A1 Pro needs a specific grblHAL profile

Evidence: `creality-falcon-a1-pro-compatible` remains broad and has no explicit `controllerKind`.

Impact: without detection, selecting the Falcon-compatible profile still selects the default GRBL-family behavior rather than a truthful grblHAL identity. This is currently low motion risk because the GRBL/grblHAL wire path is compatible, but it is poor profile truth.

#### P2 - Import path bypasses controller-facts preservation

Evidence: `MachineSetupImportExport.tsx` applies reviewed imports via `replaceDeviceProfile(profile)`.

Impact: importing a profile while connected can overwrite controller-read dimensions/feed/identity unless the imported profile happens to match. This may be acceptable as an explicit import action, but it should warn or use a shared merge helper.

#### P2 - Catalog-wide tests still do not exercise every profile as a workflow

Evidence: current catalog tests validate profile shape/evidence and representative driver/output behavior, but do not iterate every built-in profile through driver resolution, output behavior, project/profile round-trip, and a tiny safe line-job export.

Impact: "profile validates" is not the same as "profile survives core workflows."

### Recommended Fix Ticket Order

1. Extract shared "overlay profile identity with controller facts" merge logic and use it from Machine Setup, Device Setup, and possibly import review.
2. Add failing tests first for Device Setup preserving `detectedControllerKind: 'grblhal'` and preserving frame feed after a controller read.
3. Add pure profile suggestion logic with ranked `suggested`, `possible`, and `manual-only` outputs.
4. Add the specific `Creality Falcon A1 Pro (grblHAL)` profile, keep the old compatible profile ID as a fallback.
5. Add operator-facing confidence labels to catalog cards and tests for those labels.
6. Add catalog-wide workflow tests that iterate all built-in profiles through validation, controller driver resolution, output behavior, project/profile IO, and tiny safe job export.
7. Keep air-assist command enablement explicit: do not auto-enable M7/M8 from a capability or profile suggestion.

## Answer

Machine profiles can be part of auto-detect, but they should not replace controller-read truth automatically.

Correct model:

1. Controller auto-detect remains the source of machine facts:
   - firmware family from banner (`grbl-v1.1`, `grblhal`, `fluidnc`, `marlin`, `smoothieware`)
   - bed size from `$130/$131`
   - max feed from `$110/$111`
   - acceleration from `$120/$121`
   - S range from `$30/$31`
   - laser mode from `$32`
   - Z travel from `$132`
2. Machine profiles become identity/default candidates:
   - name, vendor, family
   - output dialect
   - streaming mode
   - feature defaults
   - material-library matching
   - user-facing confidence/evidence
3. The app should suggest a profile with a confidence score and require operator confirmation before committing it.

Reason: a `$` settings dump can often identify the controller family and dimensions, but it cannot reliably distinguish "Creality Falcon A1 Pro" from a generic 400x400 grblHAL controller without additional vendor metadata.

## Catalog Inventory

Built-in catalog entries currently audited:

| Profile | Current status | Main concern |
| --- | --- | --- |
| `generic-grbl-400x400` | Structurally valid, default starter | Not a machine identity; should never be treated as "verified machine setup." |
| `creality-falcon-a1-pro-compatible` | Structurally valid; Falcon-compatible output tested | Does not explicitly set `controllerKind: 'grblhal'`; relies on detected/controller state to preserve Falcon A1 Pro firmware identity. |
| `neotronics-4040-max-lt4lds-v2-20w` | Structurally valid; custom safe dialect tested | Frames at 2000 mm/min by design unless controller-detected/current framing feed is preserved; air-assist capable but command is still disabled by default. |
| `xtool-d1-pro` | Structurally valid | Evidence is unverified public-spec starter only. |
| `sculpfun-s30` | Structurally valid | Evidence is unverified public-spec starter only. |
| `ortur-laser-master-3` | Structurally valid | Evidence is unverified public-spec starter only. |
| `generic-grblhal` | Structurally valid; grblHAL driver path tested | Generic firmware profile, not a vendor/model profile. |
| `generic-fluidnc` | Structurally valid; driver path tested | Simulator/protocol confidence only; real machine config lives in FluidNC YAML and is not fully inferable from `$` settings. |
| `generic-marlin-laser` | Structurally valid; Marlin output strategy tested | Firmware variants vary widely; current default assumes inline LASER_FEATURE and S 0-255. |
| `generic-smoothieware` | Structurally valid; Smoothieware output strategy tested | Simulator/protocol only; inherited generic dialect field is semantically less clear even though Smoothie strategy handles output. |
| `generic-ruida-rd-export` | Structurally valid; `.rd` encoder round-trips internally | File-export only and explicitly not accepted by real Ruida hardware yet. |

## Evidence Checked

Source files:

- `src/core/devices/profile-catalog.ts`
- `src/core/devices/device-profile.ts`
- `src/core/controllers/detect-controller.ts`
- `src/core/controllers/grbl/parse-settings.ts`
- `src/ui/laser/device-setup/device-setup-flow.ts`
- `src/ui/laser/device-setup/DeviceSetupWizard.tsx`
- `src/ui/laser/MachineSetupProfiles.tsx`
- output strategy and controller-driver tests for GRBL, grblHAL, FluidNC, Marlin, Smoothieware, and Ruida

Verification command passed:

```powershell
pnpm exec vitest run src/core/devices/profile-catalog.test.ts src/core/devices/device-profile.test.ts src/core/devices/gcode-dialects.test.ts src/core/controllers/grbl-family-drivers.test.ts src/core/controllers/detect-controller.test.ts src/core/controllers/grbl/parse-settings.test.ts src/core/output/grbl-strategy.test.ts src/core/output/grbl-strategy-machine-compatibility.test.ts src/core/output/marlin-strategy.test.ts src/core/output/smoothieware-strategy.test.ts src/core/controllers/ruida/ruida.test.ts src/ui/laser/device-setup/device-setup-flow.test.ts src/ui/laser/device-setup/DeviceSetupWizard.test.tsx src/ui/laser/MachineSetupDialog.test.tsx
```

Result: 14 test files passed, 130 tests passed. Existing React `act(...)` warning remains in `DeviceSetupWizard.test.tsx`; it was not introduced by this audit.

## Findings

### P1 - Auto-detect does not currently identify a concrete machine profile

`detectControllerFromBanner(...)` maps banners only to firmware family. The `$` settings parser maps controller settings to a `DeviceProfile` patch. There is no profile-matching/scoring layer that says "this looks like Falcon A1 Pro" or "this looks like xTool D1 Pro."

Impact: the operator can still pick an incompatible profile manually, and the app cannot explain profile confidence beyond the catalog notes.

Suggested fix later: add a pure `suggestMachineProfiles(detection)` function that scores catalog entries from controller kind, bed size tolerance, S range, Z travel, and optional serial/vendor hints. Show suggestions as "Suggested" / "Possible" / "Manual only", never as silent auto-apply.

### P1 - Device Setup wizard overlays numeric detected settings, but not detected firmware identity

The setup wizard stores `detectedSettings` and applies presets as `{ ...profile, ...state.detected }`. It does not consume `detectedControllerKind`.

Impact: if the controller banner says `grblHAL` and the user chooses the Falcon-compatible profile during Device Setup, the committed profile can keep the Falcon profile's undefined controller kind instead of the detected `grblhal`. The Machine Setup catalog path was fixed in commit `0053665`, but this wizard path still needs the same firmware-identity preservation.

Suggested fix later: thread `detectedControllerKind` into the wizard reducer or apply step, and preserve it when a profile is applied after detection.

### P1 - "Works" is currently mixed across three confidence levels

The app currently has:

1. Hardware-verified / user-confirmed style notes for Falcon/grblHAL-era paths.
2. Simulator/protocol-tested generic firmware paths.
3. Public-spec starter profiles marked unverified.

Those all appear in one catalog list.

Impact: users can read a profile card as "this machine works" when it really means "this object validates and gives you a starting point."

Suggested fix later: show a clear badge on every card: `Hardware verified`, `Simulator tested`, `Public-spec starter`, or `Experimental`.

### P1 - Air-assist capability and air-assist enabled state are easy to confuse

Profiles such as Falcon-compatible and Neotronics include the `air-assist` capability, but `airAssistCommand` can still be `none`.

Impact: a user can believe air assist is enabled because the profile supports it, while generated jobs still emit no `M7`/`M8` unless the command is explicitly configured.

Suggested fix later: split UI wording into:

- "Machine has air-assist hardware"
- "Software air output command: Disabled / M7 / M8"

The manual air override work should continue to update the command setting only after explicit confirmation.

### P2 - Falcon A1 Pro profile is too broad for grblHAL hardware

`creality-falcon-a1-pro-compatible` inherits the generic default and does not explicitly set `controllerKind`.

Impact: with no prior detection, selecting this profile picks the default GRBL driver. The GRBL and grblHAL drivers are intentionally wire-compatible today, so this is not immediately dangerous, but it is less clear than it should be for the user's Falcon A1 Pro.

Suggested fix later: split this into:

- `Creality Falcon A1 Pro (grblHAL)` with `controllerKind: 'grblhal'`
- `Falcon-compatible GRBL diode` for generic byte-stable output fallback

### P2 - Profile test coverage validates structure, not every real workflow per profile

Current tests prove:

- all catalog profile IDs are present
- validator accepts all entries
- brand starter profiles are marked unverified
- selected drivers/output strategies work for representative devices
- Falcon-compatible output remains byte-stable with the default GRBL output
- Machine Setup catalog now preserves controller-read motion facts

Current tests do not prove:

- every catalog entry can compile a tiny Line/Fill/Raster/Frame scenario safely
- every entry can round-trip through project save/load and `.lfmachine` import/export
- every entry's air-assist behavior matches the UI wording
- every entry has a realistic profile-confidence badge
- every entry has a hardware smoke record

Suggested fix later: add a catalog-wide profile invariant test that iterates every profile and checks driver selection, output-strategy selection, tiny line-job emission/export behavior, preflight bounds, safe laser-off travel invariant, and project/profile round-trip.

## Recommended Implementation Plan

1. Add profile suggestion logic, not silent auto-profile replacement.
2. Preserve `detectedControllerKind` through the Device Setup wizard, matching the Machine Setup catalog fix.
3. Add confidence badges and explicit "not hardware verified" wording to the catalog UI.
4. Add catalog-wide workflow tests that iterate every profile.
5. Split the Falcon profile into a specific Falcon A1 Pro grblHAL profile and a broader Falcon-compatible fallback.
6. Clarify air-assist capability versus enabled output command.

## Bottom Line

The profiles do not all have the same proof level. The catalog is structurally valid and the focused profile/driver/output test slice passes, but "all profiles work" is not proven yet. The next correct step is a profile-audit/fix ticket focused on auto-detect suggestions, firmware-kind preservation in the setup wizard, profile confidence labels, and catalog-wide workflow tests.
