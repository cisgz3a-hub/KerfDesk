# Settings, calibration and camera remediation

Baseline: `ccaa3064d9efe904821307f0603ce842d903b586`. Branch: `codex/feature-quality-settings-20260905`.

Implemented all seven assigned findings without changing the Frame-first Start contract, machine policy, provider state or hardware state.

| Finding | Result | Focused regression evidence |
| --- | --- | --- |
| F08-01 | Reciprocal density controls accept fractional intervals; hidden canonical density preserves the entered value instead of resaving rounded display text. Image density retains the existing six-decimal raster normalization. | Native button click and `requestSubmit` for Fill/Image at 300 and 287.35 LPI/DPI, plus interval-first input at 0.08337 mm. |
| F08-02 | Grayscale minimum power follows the current draft maximum and reconciles downward when maximum power decreases. | Native submission of 50–80% after raising the old 20% maximum; reducing 80% to 30% also reduces a 50% minimum to 30%. |
| F09-01 | Material settings and details read only their owned controls. An absent control retains its recipe setting; an unchecked rendered checkbox writes false. | Complete unchanged Line/Fill/Image edit/Next/Save roundtrips preserve nondefault recipe fields. |
| F09-02 | The settings step explicitly records the Recipe Air checkbox. | Both true-to-false and false-to-true persist through Save/reopen and actual layer assignment. |
| F15-01 | Core fit-coupon generation rejects nonfinite/nonpositive CNC relief diameters before geometry. Incomplete dialog text stays incomplete and produces a field-specific issue. | Blank dialog submission cannot generate or persist; zero, negative and nonfinite core values return invalid; a valid tool produces relief vertices; laser coupons require no hidden diameter. |
| F16-01 | Both calibration dialogs validate every required numeric draft before persistence or scene replacement. Core numeric callers retain the existing normalization contract, now including finite zero/negative feeds, so normalized feed is positive. | Every blank field, plus invalid speeds, rejects native and direct submit. Valid dialog settings and direct normalized generator inputs compile and emit through the actual GRBL strategy. |
| F18-01 | Auto-align returns proposed alignment data. The wizard owns the commit through its exact request, document epoch, device, source/source epoch and marker-plane height. Retirement is latched and subscriptions released; old results cannot revive after inputs are restored. | Deferred capture after Exit/project replacement, document/device/source/height changes, Exit/reopen/newer solve, and stale rejection causes no late profile/surface/wizard mutation. Minimize/expand preserves the current request and successful save. |

The camera request belongs to the wizard rather than a mounted Detect view, because minimize/expand remounts that view. Input changes retire the pending request immediately and return its current Detect step to idle; resolving the old capture later changes nothing. Capture and marker math are mocked in these tests. No camera, controller or external network service is contacted.

## Verification

- Offline dependencies: `pnpm install --offline --frozen-lockfile --ignore-scripts`; no lockfile changes.
- Final regression run: **8 files, 45 tests passed**, 22.53 seconds. This includes 35 new tests and 10 existing tests rerun after the final component factoring.
- Neighboring suites: **12 files, 63 tests passed**, 24.42 seconds. Across both runs there are **98 distinct tests in 18 files**; the two overlapping files contain 10 tests.
- `pnpm typecheck`: passed after final source/test changes.
- ESLint on all changed/new TypeScript files with `--max-warnings=0`: passed.
- Prettier check on changed/new files and `git diff --check`: passed.
- React component review covered state ownership, modal/async lifecycle, labelled controls, required fields and visible validation feedback.

New tests: `CutSettingsDialog.native-submit.test.tsx`, `MaterialPresetWizard.roundtrip.test.tsx`, `CalibrationDrafts.validation.test.tsx`, `calibration-grid-feed.test.ts`, `BoxFitTestDialog.test.tsx`, and `CameraAlignWizard.ownership.test.tsx` beside their implementations. The original auto-align tests now exercise the computation-only outcome API.

The first test draft expected unrounded binary64 image density; its assertions were corrected to the already-established six-decimal raster conversion. Initial lint findings were resolved by extracting the power inputs and simplifying the camera ownership predicate. No failing checks remain.

Scope limits: these are code/DOM/simulated-I/O tests, not browser visual, real-camera, material-cutting or hardware qualification. Existing generator normalization remains deliberate; incomplete user drafts are rejected before reaching it. No application deployment or provider mutation was performed by this lane.
