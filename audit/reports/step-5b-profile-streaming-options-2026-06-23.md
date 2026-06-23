# Step 5B: Profile Streaming Options Audit

Date: 2026-06-23
Scope: LaserForge-2.0 GRBL streaming mode and RX-buffer profile wiring.

## Locked Outcome

Machine profiles can carry GRBL streaming constraints, and the real Start workflow uses those constraints when creating the live streamer. Existing machines remain byte/behavior compatible because the default stays `char-counted` with a 120-byte RX window.

Out of scope: UI controls for editing streaming mode, automatic RX-buffer probing, hardware smoke, exported G-code changes, and non-GRBL controllers.

## Research Evidence

- LaserForge current code: `src/ui/state/laser-job-actions.ts` used `findOversizedLine(gcode)` and `createStreamer(gcode)` with defaults only.
- LaserForge current code: `src/ui/laser/start-job-flow.ts` called `laser.startJob(prepared.gcode)` with no active profile options.
- Rayforge reference, study-only:
  - `C:\Users\Asus\Rayforge\website\docs\reference\firmware.md:100-116` documents a GRBL Serial Simple ping-pong driver for devices where buffer-counting causes false alarms or communication errors.
  - `C:\Users\Asus\Rayforge\website\docs\machine\general.md:24-28` describes buffer-counting as the normal GRBL driver and ping-pong as the fallback driver.
  - `C:\Users\Asus\Rayforge\CHANGELOG.md:212-217` and `:279-280` mention RX-buffer override/handling fixes and caching detected RX buffer size to avoid overflow.

No Rayforge code was copied.

## Failing Proof

Added failing tests before implementation:

- `src/ui/state/laser-store-streaming-options.test.ts`
  - `startJob(..., { rxBufferBytes: 10 })` did not reject a line longer than 10 bytes.
  - `startJob(..., { streamingMode: 'ping-pong' })` still sent the whole first buffer window instead of one line.

Both failed against the starting checkout and pass after implementation.

## Implementation Summary

- Added `src/core/grbl-streaming.ts` as the shared core source for GRBL streaming mode and RX-buffer defaults/validation.
- Added `DeviceProfile.streamingMode` and `DeviceProfile.rxBufferBytes`; defaults are `char-counted` and `120`.
- Wired `.lf2`, `.lfmachine.json`, and `.lfml.json` validation/backfill/round-trip for the new fields.
- Split material-library device-hint parsing into `src/io/material-library/material-library-device-hint.ts` to keep complexity and file length below repo caps.
- Updated `startJob` to accept streamer options and use the same normalized RX limit for both oversized-line guard and streamer creation.
- Updated `runStartJobFlow` to pass the active project profile settings into `startJob`.

## Verification

- `pnpm exec vitest run src/ui/state/laser-store-streaming-options.test.ts src/ui/state/laser-store.test.ts src/ui/laser/start-job-flow.test.ts src/io/project/project-device-profile-metadata.test.ts src/io/machine-profile/machine-profile-io.test.ts src/io/material-library/material-library-io.test.ts src/core/controllers/grbl/streamer.test.ts --reporter=dot` passed: 7 files, 86 tests.
- `pnpm typecheck` passed.
- `pnpm exec prettier --check ...` passed for touched files.
- `pnpm lint` passed. Existing boundaries legacy-selector warning remains unchanged.
- `pnpm test` passed: 343 files, 2118 tests.

Browser smoke was not required for this step because there is no new visible UI surface; the operator Start path is covered by `src/ui/laser/start-job-flow.test.ts`.

## Audit Findings

No accepted findings.

Rejected false positives:

- "Ping-pong profile should be defaulted for the Neotronics 4040." Rejected. The evidence supports making ping-pong available per profile, not changing a live-machine default without hardware confirmation.
- "RX buffer should accept any positive number." Rejected. Imported profile data is untrusted, so values are bounded to positive integers up to 4096 while direct runtime options normalize invalid values to the safe default.
- "Material-library device hints do not need streaming fields." Rejected. Device hints already preserve safety-relevant machine context; streaming constraints are now part of that context.

## Rating

Correctness: 10/10
Safety: 10/10
UX: 10/10
Regression coverage: 10/10
Real-artifact evidence: 10/10
Maintainability: 10/10
Docs/audit clarity: 10/10

Overall Step Rating: 10/10
