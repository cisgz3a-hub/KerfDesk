# Power and Controller Post-Fix Audit

Date: 2026-06-01
Repo: `C:\Users\Asus\LaserForge-2.0`
Scope: follow-up audit after fixing the controller/power findings from `audit/reports/power-controller-audit-2026-06-01.md`.

## Fixes Applied

### `$30` power-scale readiness

- Added `runControllerReadiness` to block live Start when controller settings are unknown, `$30` is missing, or controller `$30` differs from the project profile.
- The live Start path now calls `prepareStartJob`, so unsafe controller readiness fails before streaming any G-code.
- The laser store now keeps the last detected controller settings separately from the dismissible banner state.

### `$31` and `$32` visibility

- `DeviceProfile` now includes `minPowerS` (`$31`) and `laserModeEnabled` (`$32`).
- GRBL `$$` parsing now maps `$31` and `$32`.
- Detected Settings now displays `$31` and `$32`.
- Device Settings now lets the operator see/edit `$31` and `$32`.
- Live Start blocks if `$32=0` or if `$32` was not reported.
- Live Start warns, but does not block, when `$31` is nonzero.

### Trace/vector intent

- Live Start now warns when a `traced-image` will run as vector Line/Fill output instead of raster image engraving.
- The warning explicitly says it will use M3 constant-power moves and can cut if power/speed are too aggressive.

### Uncalibrated material defaults

- Live Start now warns when an output layer is still using first-run defaults: 30% power, 1500 mm/min, 1 pass.
- This does not replace a full Material Test generator. It prevents the app from silently implying the defaults are calibrated.

## Verification

- Focused tests: 49 passed across parser, device profile, controller readiness, live settings state, Start preparation, warnings, detected-settings UI, and project serialization.
- Full test suite: 97 files passed, 777 tests passed.
- Production build: passed via `npm.cmd run build`.
- Render check: headless Chrome captured the actual LaserForge UI on `http://127.0.0.1:5175/`; Device panel shows `$30`, `$31`, and `$32 laser mode`.

## Residual Risk

- Save G-code remains offline/profile-based and does not have live controller confirmation. The live Start path is now gated.
- The app still does not include a full LightBurn-style Material Test generator or persisted material library. It now warns on uncalibrated defaults, but calibration workflow remains future work.
- No hardware burn was performed in this pass.

## Result

The high-risk causes from the 30% cut-through incident are now mitigated in live Start:

- `$30` mismatch cannot silently stream.
- `$32=0` cannot silently stream.
- `$31>0` is surfaced.
- Trace-as-vector output is called out before Start.
- Default layer settings are called out as uncalibrated.
