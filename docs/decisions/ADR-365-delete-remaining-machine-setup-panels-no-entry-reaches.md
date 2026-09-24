## ADR-365 - Delete the remaining Machine Setup panels that no app entry reaches (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Completes the deletion that ADR-240 deferred ("folding or deleting them stays a separate refactor
decision") for the legacy Machine Setup modules that ADR-363 left "for a separate change".

### Context

The production import graph from `src/ui/app/main.tsx` uses the edges described in ADR-363: static
and dynamic imports plus `new URL(..., import.meta.url)` worker targets, without `import type`
edges. On origin/main `b34289b4c` it reaches none of the six modules below, and `git grep` finds
no importer outside tests. Each one is superseded, not waiting to be wired:

1. `src/ui/laser/MachineSetupDialog.tsx` is a compatibility wrapper that renders
   `DeviceSetupWizard`. ADR-205 (#172) routed the legacy dialog entry to the wizard, and #172
   also removed the wrapper's last caller in `DeviceSetupControls`. The rail now opens the wizard
   through `device-setup/MachineSetupDialogHost`, which `App.tsx` mounts.
2. `src/ui/laser/MachineSetupController.tsx` (`ControllerSettingsPanel`, `FirmwareWritesPanel`)
   held the Controller Settings and Firmware Writes tabs of the seven-tab dialog that #172
   removed. `FirmwareWritesPanel` sent a setting write immediately. Under ADR-205, writes follow
   the read, backup, per-setting confirmation, queue, Save, write, re-read and verify path of
   `DeviceSetupFirmwareStep` and `use-machine-setup-save.ts`.
3. `src/ui/laser/GrblLaserSetupPanel.tsx` is the note left behind when ADR-205 removed the
   fixed-value GRBL setup batch. #172 also removed its last import, in `MachineSetupController`.
4. `src/ui/laser/SafetyZonesPanel.tsx` duplicates `MachineSetupSafetyZones.tsx`. No production
   file has imported it at any point in the repository's history. The seven-tab dialog and today's
   Options step (`DeviceSetupOptionsStep`) both use `MachineSetupSafetyZones`.
5. `src/ui/laser/device-setup/DeviceSetupProbeStep.tsx` was the wizard's touch-plate step. #172
   dropped it from `DeviceSetupWizard`. ADR-205 keeps probing "a separate supervised hardware
   operation", and ADR-306 says "Probe remains reachable once": `ProbePanel` on the Machine rail.
6. `src/ui/machine/CncDetectedSettingsRow.tsx` was the CNC rail's detected-settings Apply (ADR-111
   #3a). ADR-306 gave each CNC value one writable owner, and its implementation (#663) deleted
   the row's host, the Material & Bit card. That left the dead `MachineSetupController` as its
   only importer. Machine Setup's explicit **Use detected values** (`DeviceSetupDetectedApply`)
   covers it.

### Decision

Delete all six with their dedicated tests. None is rewired: each would bring back a second writable
surface or an immediate write path that ADR-205 and ADR-306 retired.

Exports that lose their only production consumer with these files go too:

- `firmwareGridStyle` in `MachineSetupStyles.ts`, used only by `MachineSetupController`.
- The `DetectedSettingsBanner` component, with its private rows and styles. Its only mount since
  #172 was inside `ControllerSettingsPanel`. Its **Apply safe settings** wrote detected values
  straight into the project, which ADR-205 replaced with the setup draft. `describePatch` and
  `describeReviewItems` stay in the same file for `DetectedSettingsToast` and
  `DeviceSetupAutoDetect`. The file keeps its name so those importers do not change.
- `computeCncDetectedApply` and its `CncDetectedApply` type in `cnc-detected-apply.ts`, used only
  by `CncDetectedSettingsRow`. `cncDetectedSpindleScale` stays for `DeviceSetupDetectedApply`.

Audit tests that mix dead and live components drop only the dead half:

- `MachineBoundaryControls.audit.test.tsx` loses the `FirmwareWritesPanel` guarded-write test. The
  live gate keeps its own tests: `DeviceSetupFirmwareStep.test.tsx` enables **Queue $30 for Save**
  only after **Confirm write $30**, and `DeviceSetupWizard.test.tsx` covers the queued write after
  Save.
- `MachineProfileControls.audit.test.tsx` loses its `legacy` row. The `setup` row stays as one test
  of the live panel, beside `MachineSetupSafetyZones.test.tsx`.
- `MachineUtilityControls.audit.test.tsx` and `DetectedSettingsBanner.test.ts` lose their banner
  tests. The `describePatch` and `describeReviewItems` tests stay, including the powered-Z patch.

Two behaviours only the deleted row test covered move to the live control.
`DeviceSetupDetectedApply.test.tsx` checks that a CNC `$30` becomes spindle RPM only after the
operator selects the mapping (ADR-322 §6), that a reconnect with the same S scale clears that
choice (`useSpindleScaleChoice`), and that a laser-mode `$30` is never offered.
`cnc-detected-apply.test.ts` now tests `cncDetectedSpindleScale` directly.

### Consequences

- Users see no change. Nothing deleted or trimmed here was in the production bundle.
- WORKFLOW.md F-C7 no longer mentions old `MachineSetupDialog` callers.
- Left in place, because the bundle still carries them and removing them changes shipped code: the
  store actions `applyCncMachineSetup` (machine store; `applyCncMachinePreset` keeps using the
  shared `cncMachineSetupStatePatch`), `applyDetectedSettings` and `dismissDetectedSettings`
  (laser store) with `applyDetectedSettingsPatch`, the `laser.detected-settings.review`,
  `.dismiss` and `.apply-safe` control-help entries, and the powered-Z action that
  `describeReviewItems` still returns. None has a production caller or renderer now. Removing them
  is a separate change.
- No refusal, guard, Start or Frame path changes. Rule 7 / ADR-228 are untouched.

### Verification

- `pnpm build:web` passes. Each comparison built both trees with HEAD at the base commit and this
  change uncommitted, so the build SHA and time match. `dist/web` is byte-identical to origin/main's
  build at `b34289b4c` and again after the rebase onto `4fc476842`: `diff -rq` is clean across all
  237 files, service worker included, and the SHA-256 manifests match.
- The import graph reaches 2,728 modules before and after, at both bases. The unreachable list
  loses exactly the six modules deleted here and gains none. An import-aware scan of every export
  finds none that loses its last production consumer.
- `tsc --noEmit` and `tsc -p e2e/tsconfig.json` pass. Scoped ESLint (`--max-warnings=0`) and
  Prettier pass on every touched file. `check:index-exports` (no barrel touched),
  `check:file-size`, `check:soft-size`, `check:adr-numbers` and `check:e2e-discovery` (60 browser
  suites) pass.
- Vitest over `src/ui/laser` and `src/ui/machine` on `b34289b4c`, with other sessions saturating
  the CPU: 2,007 of 2,013 passed. The six failures were in four files this change does not touch:
  five time limits, and one test in `start-frame-raster-budget.test.tsx` that ran after two
  timeouts in the same file. All four files pass in isolation (17 of 17). After the rebase the
  touched and new test files pass again (41 of 41).
- The moved tests fail when their behaviour breaks. Removing the reconnect check from
  `useSpindleScaleChoice` fails the reconnect case. Dropping the laser-mode condition from
  `cncDetectedSpindleScale` fails both laser-mode cases.
- NOT verified: nothing ran on hardware, and no Playwright suite ran beyond discovery. No
  surviving browser behaviour changed.
