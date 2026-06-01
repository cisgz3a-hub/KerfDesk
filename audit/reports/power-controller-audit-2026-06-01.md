# LaserForge 2.0 Power and Controller Audit

Date: 2026-06-01
Scope: research-only audit of controller/power behavior after a reported 30% "engrave" cut through a 6 mm board.
Repo: `C:\Users\Asus\LaserForge-2.0`
Mode: audit only; no production code changes.

## Audit Prompt

See `audit/prompts/power-controller-audit-prompt-2026-06-01.md`.

## External Sources Checked

- GRBL v1.1 laser mode: https://github-wiki-see.page/m/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode
- GRBL settings `$30`, `$31`, `$32`: https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md
- LightBurn GRBL setup: https://docs.lightburnsoftware.com/legacy/CommonGrblSetups
- LightBurn Device Settings / S-value max: https://docs.lightburnsoftware.com/1.7/Reference/DeviceSettings/BasicSettings/
- LightBurn Cut Settings shared settings: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/SharedSettings/
- LightBurn GRBL power troubleshooting: https://docs.lightburnsoftware.com/latest/Troubleshooting/JobQuality/GRBLPowerOutput/
- LightBurn Line Mode: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/LineMode/
- LightBurn Material Test: https://docs.lightburnsoftware.com/latest/Reference/MaterialTest/
- LightBurn Speed vs Power: https://docs.lightburnsoftware.com/latest/Explainers/SpeedVsPower/

## Source Facts

### GRBL

- `$30` is the controller's max spindle/laser S value. Programmed S values above `$30` are accepted but PWM does not exceed the maximum output.
- `$31` is the min spindle speed. Below that minimum, nonzero PWM does not go below the firmware minimum; S0 still disables PWM.
- `$32=1` enables laser mode. With laser mode enabled, GRBL can update S during G1/G2/G3 motion without stopping.
- `M3` is constant laser power. `M4` is dynamic laser power and scales with speed; when stopped in M4 dynamic mode, output goes to zero.

### LightBurn

- S-value max must match GRBL `$30`.
- LightBurn's GRBL setup guidance calls out `$30` matching and `$32=1`.
- GRBL devices use variable power mode (M4) by default unless Constant Power Mode is enabled.
- Line mode is vector tracing; whether it only marks the surface or cuts through is a function of power and speed.
- LightBurn pushes users toward Material Test grids because speed/power is machine/material specific. It explicitly warns that mixing mm/sec and mm/min can cause excessive power output and fire.

## Current Code Map

- Device profile has `maxPowerS` only for controller power scale. It has no `$31`, `$32`, firmware version, or M3/M4 capability fields.
  - `src/core/devices/device-profile.ts:24`
  - `src/core/devices/device-profile.ts:77`
- GRBL settings collector parses `$30`, `$110/$111`, `$120/$121`, `$130/$131`, `$11`. It ignores `$31` and `$32`.
  - `src/core/controllers/grbl/parse-settings.ts:9`
  - `src/core/controllers/grbl/parse-settings.ts:88`
  - `src/core/controllers/grbl/parse-settings.test.ts:70`
- Detected-settings banner surfaces `maxPowerS`, but not `$31` or `$32`.
  - `src/ui/laser/DetectedSettingsBanner.tsx:78`
- Device settings UI exposes `$30 (max S)` but not `$31` or `$32`.
  - `src/ui/laser/DeviceSettings.tsx:176`
- Preflight checks layer power range, speed, passes, layer mode mismatch, raster transform, bounds, and non-empty G1. It has no controller-readiness checks.
  - `src/core/preflight/preflight.ts:19`
  - `src/core/preflight/preflight.ts:41`
  - `src/core/preflight/preflight.ts:72`
- Vector line/fill output uses M3 constant power.
  - `src/core/output/grbl-strategy.ts:30`
  - `src/core/output/grbl-strategy.ts:36`
  - `src/core/output/grbl-strategy.ts:66`
- Raster image output uses M4 dynamic power and per-pixel S values.
  - `src/core/raster/emit-raster.ts:8`
  - `src/core/raster/emit-raster.ts:79`
- Image-mode layers compile only `raster-image` objects. `traced-image` objects compile as vector paths on line/fill layers.
  - `src/core/job/compile-job.ts:37`
  - `src/core/job/compile-job.ts:47`
  - `src/core/job/compile-job.ts:187`
- Layer defaults are 30% power, 1500 mm/min, 1 pass, line mode. Fill hatch spacing is 0.2 mm; image mode uses 10 lines/mm.
  - `src/core/scene/layer.ts:41`
  - `src/core/scene/layer.ts:48`
  - `src/core/scene/layer.ts:49`

## Findings

### P1 - `$30` mismatch can turn a displayed 30% job into actual full power

Path:
- `src/core/devices/device-profile.ts`
- `src/core/controllers/grbl/parse-settings.ts`
- `src/ui/laser/DetectedSettingsBanner.tsx`
- `src/core/preflight/preflight.ts`
- `src/core/output/grbl-strategy.ts`

Trigger:
1. The project profile defaults to `maxPowerS: 1000`.
2. The controller is actually configured with `$30=255`.
3. User runs a layer at 30%.
4. LaserForge emits S300 because `round(30 / 100 * 1000) = 300`.
5. GRBL saturates above `$30`, so S300 on a `$30=255` controller is effectively 100% output.

Failure mode:
The UI percent is not honest unless the local `maxPowerS` exactly matches the controller `$30`. Detection exists but is optional and not enforced before Start/Save.

Consequence:
High overburn/cut-through risk. This is a plausible explanation for "30% engraving cut through 6 mm board" if the firmware `$30` is lower than LaserForge's profile.

Severity: High
Confidence: High

Concrete fix:
- Make `$30` a required controller-readiness value for live Start.
- If connected and detected `$30` differs from project `maxPowerS`, block Start until the operator applies the detected setting or explicitly chooses a documented advanced override.
- For offline Save G-code, include a hard warning or require profile confirmation.
- Add regression tests proving `$30=255` plus UI 30% emits S77 after applying settings, not S300.

Verification:
- Unit test `settingsMapToProfilePatch` and preflight/controller readiness with `$30=255`.
- Generate a sample 30% vector and raster job for `$30=255`, `$30=1000`, and assert all S values are <= expected max and proportional.
- Hardware dry-run with laser disabled; inspect emitted G-code before any burn.

### P1 - `$32` laser mode is ignored even though raster/Image output depends on M4 behavior

Path:
- `src/core/controllers/grbl/parse-settings.ts`
- `src/core/controllers/grbl/parse-settings.test.ts`
- `src/core/raster/emit-raster.ts`
- `src/core/preflight/preflight.ts`

Trigger:
1. Controller has `$32=0`, old GRBL, or a GRBL-M3-only profile.
2. LaserForge runs image/raster output using `M4 S0` and per-pixel S changes.
3. Preflight passes because it only sees legal layer settings and G-code structure.

Failure mode:
The app assumes M4 dynamic laser semantics but does not parse, display, or gate on `$32`.

Consequence:
Raster/photo engraving can scorch, pause, or behave unlike preview. GRBL docs and LightBurn docs both treat `$32=1` as central for laser-mode M4 behavior.

Severity: High
Confidence: High

Concrete fix:
- Extend `DeviceProfile` or live controller state with `laserModeEnabled` parsed from `$32`.
- Surface `$32` in the detected-settings banner and Device panel.
- Add a Start preflight that blocks image/raster jobs when connected `$32 !== 1` or controller capability is unknown.
- Provide a controlled "Set `$32=1`" action with warning text, not an automatic silent write.

Verification:
- Unit test parser includes `$32=1` and `$32=0`.
- Start-preflight tests for raster jobs with `$32=0`, unknown, and enabled.
- Manual connect to Falcon/GrblHAL: `$$` shows `$32=1`, banner confirms, raster Start allowed.

### P1 - Trace output is vector Line/Fill, not image engraving, so 30% can be cutting behavior

Path:
- `src/core/job/compile-job.ts`
- `src/core/output/grbl-strategy.ts`
- `src/core/scene/layer.ts`

Trigger:
1. User imports an image and traces it.
2. The result is `traced-image`.
3. `traced-image` compiles as vector paths on line/fill layers.
4. Vector paths emit M3 constant-power G-code at layer power/speed.

Failure mode:
The user can reasonably think "I traced an image, so this is engraving," but the machine receives vector line/fill output. LightBurn documents Line Mode as vector tracing where the same mode can etch or cut depending on power and speed.

Consequence:
Dense outlines/fills at 30% and 1500 mm/min can act like cutting, especially on a powerful diode and wood/plywood. This is a second plausible explanation for the incident independent of `$30`.

Severity: High
Confidence: High

Concrete fix:
- Label trace results as "Vector trace" in UI, not generic engraving.
- Add an output warning when a `traced-image` is on a line/fill output layer: "This will run as vector Line/Fill, not raster image engraving."
- Consider defaulting traced images to Output off until the user chooses Line, Fill, or Convert/Engrave workflow.
- Consider a material-safe "score" preset for new traced vectors, separate from raster image engraving.

Verification:
- Compile a traced image and assert the job group kind is `cut`, not `raster`.
- UI regression test for warning visibility on `traced-image` line/fill output.
- Compare exported G-code: trace job contains M3 constant vector moves; image job contains M4 raster rows.

### P2 - `$31` minimum spindle speed is not parsed or surfaced

Path:
- `src/core/devices/device-profile.ts`
- `src/core/controllers/grbl/parse-settings.ts`
- `src/ui/laser/DetectedSettingsBanner.tsx`
- `src/core/preflight/preflight.ts`

Trigger:
Controller has a nonzero `$31`.

Failure mode:
Low nonzero S values may map to the firmware's minimum PWM output rather than the operator's expected low power. S0 still disables output, but the response curve near the bottom is hidden from the app.

Consequence:
Low-power focus/marking/grayscale behavior can be hotter than expected. Less likely than `$30` to explain a 30% full cut, but still part of a complete power audit.

Severity: Medium
Confidence: Medium-High

Concrete fix:
- Parse `$31` into detected controller state.
- Show it in Device/Detected Settings.
- Warn when `$31 > 0` for diode-laser profiles unless the user documents why.

Verification:
- Parser tests for `$31=0` and `$31=100`.
- UI banner test.
- Generated grayscale test verifies comments/preflight mention nonzero min behavior.

### P2 - Preflight is structural, not controller/material safety aware

Path:
- `src/core/preflight/preflight.ts`
- `src/ui/laser/LaserWindow.tsx`
- `src/io/gcode/emit-gcode.ts`

Trigger:
Any job with valid layer percent/speed/passes and in-bounds G-code.

Failure mode:
Preflight says OK even if:
- `$30` is unconfirmed or mismatched.
- `$32` is disabled/unknown for raster output.
- `$31` is nonzero/unknown.
- The layer is trace/vector Line/Fill but the user expects image engraving.
- The power/speed/material combination is uncalibrated.

Consequence:
The app can authorize Start/Save based on syntax while missing the real power/controller conditions that decide burn depth.

Severity: High for live Start, Medium for offline Save
Confidence: High

Concrete fix:
- Split preflight into `geometryPreflight` and `controllerReadinessPreflight`.
- Live Start should require confirmed `$30`, confirmed laser mode/capability, and no critical unresolved detected-settings mismatch.
- Add job-intent warnings for vector trace and first-run uncalibrated material profile.
- Save G-code can remain possible, but must carry explicit warnings if controller state is unknown.

Verification:
- Unit tests for controller-readiness preflight matrix.
- UI tests for Start blocked and Save warned in offline/unknown cases.

### P2 - No material-test or calibrated material profile exists before using defaults

Path:
- `src/core/scene/layer.ts`
- `WORKFLOW.md:786`
- `PROJECT.md:309`
- `LIGHTBURN-STUDY.md:1146`
- `LIGHTBURN-STUDY.md:1226`

Trigger:
New user uses default 30% / 1500 mm/min / 1 pass or follows the pending hardware-check values as if they are safe.

Failure mode:
Defaults are generic; they are not tied to laser wattage, lens/focus, material type, thickness, air assist, or target operation. LightBurn docs emphasize Material Test and speed/power dependence.

Consequence:
The same displayed 30% can be harmless on one machine/material and cutting on another.

Severity: Medium-High
Confidence: High

Concrete fix:
- Add a Material Test generator or at minimum a first-run calibration workflow before enabling confident Start messaging.
- Make default layer settings explicitly "uncalibrated".
- Persist material profiles with machine ID, material, thickness, operation, speed, power, passes, line interval/hatch spacing.

Verification:
- Unit tests for material profile selection and uncalibrated warnings.
- Generated material test G-code reviewed for low-risk ordering: highest speed, lowest power first, fewest passes first.

## Immediate Fix Plan

Do not start by changing the trace algorithm. The trace shape can be perfect and still burn wrong if the controller/power contract is wrong.

Recommended order:

1. Add live controller power state: `$30`, `$31`, `$32`, firmware banner/version, and M4 capability.
2. Make Start block on critical `$30` mismatch and `$32` disabled/unknown for raster/image jobs.
3. Add explicit "Vector trace is Line/Fill output" warning before running traced images.
4. Add tests for `$30=255` so 30% emits S77, not S300.
5. Add Material Test / calibration workflow before treating defaults as safe engraving settings.

## Open Questions

- What did the controller report for `$$` during the 30% board-cut incident, especially `$30`, `$31`, and `$32`?
- Was the operation a traced vector (`traced-image`) or a true raster image (`raster-image`)?
- What machine/wattage/lens/focus/air-assist/material type was used?
- Was the app profile still default `maxPowerS=1000`?

## Status

Audit/research complete enough to identify likely root causes and first fixes. Production code has not been changed in this audit pass.
