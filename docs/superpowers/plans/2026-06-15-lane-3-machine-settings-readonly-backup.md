# Lane 3 Machine Settings Read-Only and Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first safe Machine Settings workflow: read GRBL `$$` settings into typed rows, explain the important settings, preserve unknown settings, and export a backup file before any firmware write UI exists.

**Architecture:** Extend the existing GRBL settings collector instead of adding a second serial path. The collector already starts on connect and when Console sends `$$`; this lane adds a typed read-only settings table and backup export over that same data. No setting writes, load-from-file, reset, or axis calibration ship in this slice.

**Tech Stack:** TypeScript pure-core GRBL parser, Zustand laser store, React laser rail UI, existing PlatformAdapter save API, Vitest, Testing Library.

---

## Research Grounding

Official LightBurn Machine Settings docs say the window views and edits firmware settings on GRBL-based controllers, opens from Laser Tools -> Machine Settings, and that settings availability is controller-firmware dependent:

- <https://docs.lightburnsoftware.com/2.1/Reference/MachineSettings/>

The same LightBurn docs make backup the safety-first workflow: Save to File backs up controller firmware settings and is strongly recommended before modifications. Load overwrites all values and requires a prior backup from a trusted source. Read reloads controller settings; Write persists modified settings.

GRBL docs confirm the command boundary:

- `$$` views settings and `$x=val` writes settings: <https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md>
- `$x=val` stores settings in EEPROM and users verify by sending `$$` again: <https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md>
- `$30`, `$31`, and `$32` are GRBL 1.1 spindle/laser power settings; `$32=1` enables laser mode: <https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md> and <https://github.com/gnea/grbl/blob/master/doc/markdown/laser_mode.md>

Karpathy-style conclusion: do the smallest real thing first. A read-only settings table plus backup is useful, matches LightBurn's first safety step, and cannot silently damage firmware. Writes are deferred until the read/backup path has been tested on Falcon and GRBL4040 hardware.

## Current Code Facts

- `src/core/controllers/grbl/parse-settings.ts` already collects `$$` response lines into a `ReadonlyMap<number, string>`.
- The collector currently emits only a `DeviceProfile` patch and `ControllerSettingsSnapshot`.
- Unknown settings are currently ignored after the patch is computed, which is wrong for a Machine Settings backup.
- `src/ui/state/laser-console-actions.ts` already starts the settings collector before sending `$$` from Console.
- `src/ui/state/laser-line-handler.ts` already starts the collector after connect to refresh detected controller settings.
- `src/platform/types.ts` already exposes `pickFileForSave` and `SaveTarget.write(text)`, which is enough for backup export.
- `src/ui/laser/LaserWindow.tsx` owns the right rail where a compact Machine Settings panel or dialog should live.

## Scope Boundary

In scope:

- Read settings from the controller using `$$`.
- Show a read-only table of settings.
- Preserve unknown settings visibly.
- Export all captured settings to `.lfgrbl-settings.json`.
- Add help tooltips for the new controls.
- Add workflow docs and tests.

Out of scope for this slice:

- Editing or writing `$number=value` settings.
- Loading settings from a backup into firmware.
- `$RST=*`, `$N=`, `$I=`, or manufacturer reset commands.
- Axis calibration movement.
- Macros.
- Vendor-specific hidden settings editor.

## Data Model

Create `src/core/controllers/grbl/grbl-settings.ts`:

```ts
export type GrblSettingCategory =
  | 'motion'
  | 'limits'
  | 'homing'
  | 'laser'
  | 'reporting'
  | 'system'
  | 'unknown';

export type GrblSettingRow = {
  readonly id: number;
  readonly code: `$${number}`;
  readonly rawValue: string;
  readonly numericValue: number | null;
  readonly name: string;
  readonly unit: string | null;
  readonly description: string;
  readonly category: GrblSettingCategory;
  readonly known: boolean;
  readonly writeRisk: 'read-only' | 'common' | 'machine-critical' | 'unknown';
};

export type GrblSettingsBackup = {
  readonly format: 'laserforge.grbl-settings.backup';
  readonly version: 1;
  readonly createdAt: string;
  readonly settings: ReadonlyArray<GrblSettingRow>;
};
```

Known settings metadata should cover common GRBL 1.1 settings:

- `$0`, `$1`, `$10`, `$11`, `$12`, `$13`
- `$20`, `$21`, `$22`, `$23`, `$24`, `$25`, `$26`, `$27`
- `$30`, `$31`, `$32`
- `$100`, `$101`, `$102`
- `$110`, `$111`, `$112`
- `$120`, `$121`, `$122`
- `$130`, `$131`, `$132`

Unknown `$N=value` lines must become rows with `known: false`, `category: 'unknown'`, and the exact `rawValue`.

## Task 1: Pure-Core Settings Rows

- [ ] Add `src/core/controllers/grbl/grbl-settings.ts`.
- [ ] Export `settingsMapToRows(map)` sorted by numeric setting id.
- [ ] Export `createGrblSettingsBackup(rows, createdAt)` for deterministic testability.
- [ ] Keep parsing strict: finite numeric strings become `numericValue`; non-numeric values stay visible with `numericValue: null`.
- [ ] Preserve unknown settings instead of dropping them.
- [ ] Re-export the new types/functions from `src/core/controllers/grbl/index.ts`.

### Red Tests

Create `src/core/controllers/grbl/grbl-settings.test.ts`:

```ts
it('maps known GRBL laser settings to named rows');
it('preserves unknown settings as visible rows');
it('sorts rows by numeric setting id');
it('keeps non-numeric values visible without numericValue');
it('creates deterministic backup JSON data with every row');
```

Run:

```powershell
corepack pnpm exec vitest run src/core/controllers/grbl/grbl-settings.test.ts
```

Expected first run: fails because the module does not exist.

## Task 2: Collector Keeps Row Data

- [ ] Extend `SettingsCollectorState` done state in `src/core/controllers/grbl/parse-settings.ts` with `settingsRows: ReadonlyArray<GrblSettingRow>`.
- [ ] Keep `patch` and `controllerSettings` behavior unchanged.
- [ ] Add tests to `src/core/controllers/grbl/parse-settings.test.ts` proving done state includes all rows, including unknown settings.
- [ ] Do not change connect behavior, profile detection behavior, or device patch rules.

Run:

```powershell
corepack pnpm exec vitest run src/core/controllers/grbl/parse-settings.test.ts src/core/controllers/grbl/grbl-settings.test.ts
```

## Task 3: Laser Store State and Actions

- [ ] Add `grblSettingsRows: ReadonlyArray<GrblSettingRow>` and `lastSettingsReadAt: number | null` to `LaserState` in `src/ui/state/laser-store.ts`.
- [ ] Initialize/reset both fields in `src/ui/state/laser-store-helpers.ts` and disconnect cleanup.
- [ ] Update `src/ui/state/detected-settings-action.ts` to copy `settingsRows` into store when a collector completes.
- [ ] Add `readMachineSettings(): Promise<void>` to `LaserState`.
- [ ] Implement `readMachineSettings` by sending `$$` through the same guarded write path used by Console.
- [ ] Block read while disconnected, while a job is active, while jog/frame/autofocus is active, or while another settings read is in progress.
- [ ] Do not add write actions in this lane.

Tests:

Create or extend `src/ui/state/laser-store-machine-settings.test.ts`:

```ts
it('reads machine settings through the guarded serial write path');
it('populates settings rows when the $$ dump completes');
it('keeps unknown settings rows');
it('blocks read while a job is active');
it('clears machine settings rows on disconnect');
```

Run:

```powershell
corepack pnpm exec vitest run src/ui/state/laser-store-machine-settings.test.ts src/ui/state/laser-store-console.test.ts
```

## Task 4: Backup Export Helper

- [ ] Add `src/ui/laser/export-grbl-settings-backup.ts`.
- [ ] Use `PlatformAdapter.pickFileForSave({ suggestedName, extensions: ['.lfgrbl-settings.json'] })`.
- [ ] Write pretty JSON using the rows currently in store.
- [ ] Suggested file name format: `laserforge-grbl-settings-YYYY-MM-DD.lfgrbl-settings.json`.
- [ ] Return a clear result union:

```ts
type ExportGrblSettingsBackupResult =
  | { readonly ok: true; readonly displayName: string }
  | { readonly ok: false; readonly reason: 'cancelled' | 'no-settings' | 'write-failed'; readonly message: string };
```

Tests:

Create `src/ui/laser/export-grbl-settings-backup.test.ts`:

```ts
it('writes a pretty JSON backup through PlatformAdapter');
it('returns no-settings when rows are empty');
it('returns cancelled when the save picker is cancelled');
it('keeps unknown settings in the exported backup');
```

## Task 5: Machine Settings UI

- [ ] Create `src/ui/laser/MachineSettingsPanel.tsx`.
- [ ] Render inside `LaserWindow` after `GrblLaserSetupPanel` and before `DetectedSettingsBanner`.
- [ ] Use a collapsed `<details>` panel by default to avoid making the laser rail noisy.
- [ ] Header: `Machine Settings`.
- [ ] Buttons:
  - `Read ($$)`
  - `Export backup`
- [ ] Read button disabled unless connected and no active operation is running.
- [ ] Export button disabled until at least one setting row exists.
- [ ] Table columns:
  - Setting
  - Value
  - Unit
  - Meaning
- [ ] Unknown rows must be visible, not hidden.
- [ ] Include a short read-only notice:

```text
Read-only in this version. Back up settings before changing firmware.
```

- [ ] No inputs for setting values.
- [ ] No Write button.
- [ ] No Load button.

Tests:

Create `src/ui/laser/MachineSettingsPanel.test.tsx`:

```ts
it('renders collapsed by default');
it('disables read while disconnected');
it('calls readMachineSettings when Read is clicked');
it('renders known and unknown settings rows');
it('disables export until settings exist');
it('exports visible settings through PlatformAdapter');
it('does not render any write controls');
```

## Task 6: Help Registry and Workflow Docs

- [ ] Add help IDs in `src/ui/help/help-topics.ts`:
  - `control:laser.machine-settings`
  - `control:laser.machine-settings.read`
  - `control:laser.machine-settings.export`
  - `control:laser.machine-settings.table`
- [ ] Add a `WORKFLOW.md` section after `F-B13. GRBL Console`:
  - Connected read workflow.
  - Disconnected disabled workflow.
  - Alarm state read workflow.
  - Backup export workflow.
  - Explicit non-goal: no firmware writes yet.
- [ ] Update `docs/LIGHTBURN-PARITY-IMPLEMENTATION-ROADMAP-2026-06-15.md` slice status if this lane ships.

## Task 7: Audit and Gates

Run focused tests first:

```powershell
corepack pnpm exec vitest run src/core/controllers/grbl/grbl-settings.test.ts src/core/controllers/grbl/parse-settings.test.ts src/ui/state/laser-store-machine-settings.test.ts src/ui/laser/export-grbl-settings-backup.test.ts src/ui/laser/MachineSettingsPanel.test.tsx
```

Then full gates:

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build:web
```

Audit checklist:

- [ ] No direct serial write path was added.
- [ ] `$$` reads still use existing guarded write behavior.
- [ ] No firmware write UI exists.
- [ ] Unknown settings survive in UI and backup.
- [ ] Backup export contains all rows.
- [ ] Console `$$` still refreshes detected settings.
- [ ] No job execution, frame, jog, trace, bitmap, or G-code output logic changed.

## Browser Smoke

Use local app after implementation:

```powershell
corepack pnpm dev --host 127.0.0.1
```

Smoke steps:

1. Open the local app.
2. Confirm Machine Settings is collapsed by default.
3. Confirm disconnected Read is disabled and explains why.
4. Inject/store-test visible settings or connect hardware and send `$$`.
5. Confirm `$30`, `$31`, `$32`, `$130`, `$131`, and unknown rows display.
6. Export backup and inspect JSON.
7. Confirm there is no Write or Load button.

## Hardware Checklist

Falcon:

1. Connect.
2. Open Machine Settings.
3. Click Read.
4. Export backup.
5. Confirm no write controls exist.

GRBL4040:

1. Connect.
2. Clear alarm safely if required.
3. Click Read.
4. Verify `$30`, `$32`, `$130`, and `$131` match the setup values used by the tester.
5. Export backup before any future setup changes.

## Implementation Order

1. Pure-core rows and backup model.
2. Collector done-state rows.
3. Store read action and state.
4. Backup export helper.
5. Machine Settings panel.
6. Help registry and workflow docs.
7. Focused audit.
8. Full gates.
9. Browser smoke.
10. Commit and push after the audit is clean.

## Deferred Lane 3B

After this read-only slice passes hardware:

- Add setting edit drafts.
- Restrict writes to a whitelist.
- Require Idle and explicit confirmation.
- Force backup before first write in a session.
- Write one setting at a time.
- Re-read `$$` immediately after write.
- Show before/after diff.
- Preserve automatic backups before every firmware write.

