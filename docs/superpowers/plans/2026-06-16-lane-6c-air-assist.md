# Lane 6C Air Assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LightBurn-style per-layer Air Assist support without changing existing G-code unless the operator explicitly enables a tested device M-code.

**Architecture:** Air assist is modeled as a layer intent plus a device capability. The compiler carries layer intent into the Job IR, while the GRBL emitter owns coolant modal transitions (`M7`/`M8`/`M9`) next to the existing `M3`/`M4`/`M5` modal laser handling. Stop/disconnect cleanup is updated because GRBL feed hold pauses motion but does not disable coolant.

**Tech Stack:** TypeScript, React, Zustand, Vitest, GRBL v1.1 G-code, Web Serial.

---

## Research Baseline

- LightBurn Shared Settings documents Air Assist as a cut-setting switch that only has effect when the laser supports it; for GCode devices the command is selected as `M7` or `M8` in Device Settings.
  Source: https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/SharedSettings/
- LightBurn Device Settings documents the device-level Air Assist setting as the choice of whether LightBurn uses `M7` or `M8`.
  Source: https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/BasicSettings/
- GRBL documents coolant as its own modal state group (`M7`, `M8`, `M9`), and notes that `M7` mist coolant requires a compile-time option while `M8` flood coolant is the common coolant pin.
  Source: https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md
- GRBL documents that feed hold does not disable spindle or coolant; it only pauses motion. LaserForge must not treat Pause or a stopped streamer as proof the accessory output is off.
  Source: https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md
- GRBL interface docs distinguish realtime commands from normal queued line commands. `M7`/`M8`/`M9` are normal G-code line commands, not realtime bytes.
  Source: https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md

## Scope

Implement in this lane:

- `DeviceProfile.airAssistCommand: 'none' | 'M7' | 'M8'`
- `Layer.airAssist: boolean`
- Cut Settings shared-field checkbox
- Device Settings select for Disabled / M7 / M8
- Project and material-library persistence/defaulting
- Compile Job IR propagation
- GRBL output emission of `M7`/`M8` before an air-enabled group and `M9` before air-disabled motion / postamble
- Stop/disconnect cleanup best-effort `M9` while serial is still alive
- Tests proving default G-code remains unchanged when disabled

Do not implement in this lane:

- Air-pressure control, PWM air, compressor warm-up delays, custom start/end scripts, per-pass air changes, sub-layer air overrides, or automatic material recommendations.
- Any claim that air assist will fix uneven burning. The software only emits accessory control; real burn quality still depends on focus, material, power, speed, lens cleanliness, and machine wiring.

## File Structure

- Modify `src/core/devices/device-profile.ts`
  - Add `AirAssistCommand` type and default `airAssistCommand: 'none'`.
- Modify `src/core/scene/layer.ts`
  - Add `airAssist: boolean` to `Layer` and `LAYER_DEFAULTS`.
- Modify `src/core/job/job.ts`
  - Add `airAssist: boolean` to `CutGroup`, `FillGroup`, and `RasterGroup`.
- Modify `src/core/job/compile-job.ts`
  - Copy `layer.airAssist` onto vector and raster groups.
- Modify `src/core/output/grbl-strategy.ts`
  - Add coolant modal management around `emitAnyGroup`.
- Modify `src/core/controllers/grbl/commands.ts`
  - Add `CMD_COOLANT_OFF = 'M9'`.
- Modify `src/ui/state/laser-job-actions.ts`
  - On Stop, send soft reset and best-effort coolant-off when the port is still alive.
- Modify `src/ui/state/laser-store-helpers.ts`
  - Use an explicit stop-before-disconnect payload that includes coolant-off where it can be sent safely.
- Modify `src/io/project/deserialize-project.ts`
  - Backfill missing layer/device air fields.
- Modify `src/io/project/project-shape-validator.ts`
  - Accept optional `layer.airAssist` and optional `device.airAssistCommand`.
- Modify `src/io/material-library/material-library-io.ts`
  - Include `airAssistCommand` in device hints.
- Modify `src/core/material-library/*`
  - Include `airAssist` in material recipes if recipe helpers currently enumerate fields manually.
- Modify `src/ui/layers/cut-settings-draft.ts`
  - Read `airAssist` from the dialog form.
- Modify `src/ui/layers/CutSettingsCommonFields.tsx`
  - Add the Air Assist checkbox.
- Modify `src/ui/laser/DeviceSettings.tsx`
  - Add the device-level Air Assist command select.
- Modify help/tooltip registry files if the new controls need explicit help IDs.

## Implementation Tasks

### Task 0: Lock the Current Lane Boundary

**Files:**
- No production files.

- [ ] **Step 1: Confirm the checkout and current dirty state**

Run:

```powershell
git rev-parse --show-toplevel
git status --short --branch
```

Expected:

```text
C:/Users/Asus/LaserForge-2.0
## main...origin/main
```

The working tree may still contain Lane 6A / Lane 6B files. Do not start this lane until those changes are committed or intentionally left as a known base.

- [ ] **Step 2: Commit or consciously stack on Lane 6A / 6B**

Preferred command if Lane 6A / 6B verification is still green:

```powershell
git add src docs
git commit -m "feat: consolidate cut settings defaults"
```

Expected: one commit containing the already-verified Lane 6A / 6B work.

### Task 1: Add Core Device and Layer Types

**Files:**
- Modify `src/core/devices/device-profile.ts`
- Modify `src/core/devices/device-profile.test.ts`
- Modify `src/core/scene/layer.ts`
- Modify `src/core/scene/layer.test.ts`

- [ ] **Step 1: Write failing device-profile tests**

Add tests to `src/core/devices/device-profile.test.ts`:

```ts
it('defaults air assist command to none so output is unchanged until configured', () => {
  expect(DEFAULT_DEVICE_PROFILE.airAssistCommand).toBe('none');
});

it('uses a narrow air assist command enum', () => {
  const valid: ReadonlyArray<DeviceProfile['airAssistCommand']> = ['none', 'M7', 'M8'];
  expect(valid).toContain(DEFAULT_DEVICE_PROFILE.airAssistCommand);
});
```

Run:

```powershell
corepack pnpm vitest run src/core/devices/device-profile.test.ts
```

Expected: FAIL because `airAssistCommand` does not exist.

- [ ] **Step 2: Implement device profile type**

In `src/core/devices/device-profile.ts`, add:

```ts
export type AirAssistCommand = 'none' | 'M7' | 'M8';
```

Add to `DeviceProfile`:

```ts
readonly airAssistCommand: AirAssistCommand;
```

Add to `DEFAULT_DEVICE_PROFILE`:

```ts
airAssistCommand: 'none',
```

- [ ] **Step 3: Write failing layer tests**

Add tests to `src/core/scene/layer.test.ts`:

```ts
it('defaults air assist off for every new layer', () => {
  expect(LAYER_DEFAULTS.airAssist).toBe(false);
  expect(createLayer({ id: 'L1', color: '#000000' }).airAssist).toBe(false);
});
```

Run:

```powershell
corepack pnpm vitest run src/core/scene/layer.test.ts
```

Expected: FAIL because `airAssist` does not exist.

- [ ] **Step 4: Implement layer field**

In `src/core/scene/layer.ts`, add to `Layer`:

```ts
readonly airAssist: boolean;
```

Add to `LAYER_DEFAULTS`:

```ts
airAssist: false,
```

- [ ] **Step 5: Verify Task 1**

Run:

```powershell
corepack pnpm vitest run src/core/devices/device-profile.test.ts src/core/scene/layer.test.ts
```

Expected: PASS.

### Task 2: Persist and Validate Air Assist Fields

**Files:**
- Modify `src/io/project/deserialize-project.ts`
- Modify `src/io/project/project-shape-validator.ts`
- Modify `src/io/project/project.test.ts`

- [ ] **Step 1: Write failing project backfill tests**

Add to `src/io/project/project.test.ts`:

```ts
it('backfills missing air assist fields from older projects', () => {
  const base = createProject();
  const raw = JSON.parse(serializeProject(base)) as Record<string, unknown>;
  const device = raw.device as Record<string, unknown>;
  delete device.airAssistCommand;
  const scene = raw.scene as { layers: Array<Record<string, unknown>> };
  delete scene.layers[0].airAssist;

  const result = deserializeProject(JSON.stringify(raw));

  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') return;
  expect(result.project.device.airAssistCommand).toBe('none');
  expect(result.project.scene.layers[0].airAssist).toBe(false);
});

it('rejects invalid air assist command values', () => {
  const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
  (raw.device as Record<string, unknown>).airAssistCommand = 'M106';

  const result = deserializeProject(JSON.stringify(raw));

  expect(result).toMatchObject({ kind: 'invalid' });
});
```

Run:

```powershell
corepack pnpm vitest run src/io/project/project.test.ts
```

Expected: FAIL until validation and normalization are implemented.

- [ ] **Step 2: Add optional validators**

In `src/io/project/project-shape-validator.ts`, add to `validateDevice`:

```ts
optionalLiteral(device, 'device.airAssistCommand', ['none', 'M7', 'M8']),
```

Add to `validateLayer`:

```ts
optionalBoolean(layer, `${path}.airAssist`),
```

- [ ] **Step 3: Add normalization defaults**

In `src/io/project/deserialize-project.ts`, add in `normalizeProject().device`:

```ts
airAssistCommand:
  dev['airAssistCommand'] === 'M7' || dev['airAssistCommand'] === 'M8'
    ? dev['airAssistCommand']
    : DEFAULT_DEVICE_PROFILE.airAssistCommand,
```

Add in `normalizeLayer` or a new `normalizeCommonLayerFields` helper:

```ts
if (typeof out['airAssist'] !== 'boolean') {
  out['airAssist'] = LAYER_DEFAULTS.airAssist;
}
```

- [ ] **Step 4: Verify Task 2**

Run:

```powershell
corepack pnpm vitest run src/io/project/project.test.ts
```

Expected: PASS.

### Task 3: Carry Air Assist Through Job Compilation

**Files:**
- Modify `src/core/job/job.ts`
- Modify `src/core/job/compile-job.ts`
- Modify `src/core/job/compile-job.test.ts` or the existing focused compile tests.

- [ ] **Step 1: Write failing compile tests**

Add tests that compile one line, one fill, and one image layer with `airAssist: true`.

Expected assertion shape:

```ts
expect(job.groups[0]).toMatchObject({ airAssist: true });
```

Run:

```powershell
corepack pnpm vitest run src/core/job/compile-job.test.ts
```

Expected: FAIL because groups do not carry `airAssist`.

- [ ] **Step 2: Extend Job IR**

In `src/core/job/job.ts`, add:

```ts
readonly airAssist: boolean;
```

to `CutGroup`, `FillGroup`, and `RasterGroup`.

- [ ] **Step 3: Populate from layer settings**

In `src/core/job/compile-job.ts`, add to raster return object:

```ts
airAssist: layer.airAssist,
```

Add to `common` in `vectorGroupForLayer`:

```ts
airAssist: layer.airAssist,
```

- [ ] **Step 4: Verify Task 3**

Run:

```powershell
corepack pnpm vitest run src/core/job/compile-job.test.ts
```

Expected: PASS.

### Task 4: Emit Coolant M-Codes Safely

**Files:**
- Modify `src/core/output/grbl-strategy.ts`
- Modify `src/core/output/grbl-strategy.test.ts`
- Modify `src/io/gcode/emit-gcode.snapshot.test.ts` only if snapshots intentionally include air-enabled fixtures.

- [ ] **Step 1: Write disabled-output parity test**

Add to `src/core/output/grbl-strategy.test.ts`:

```ts
it('does not emit coolant commands when device air assist is disabled', () => {
  const gcode = grblStrategy.emit(
    {
      groups: [
        {
          kind: 'cut',
          layerId: 'L1',
          color: '#000000',
          power: 30,
          speed: 1000,
          passes: 1,
          airAssist: true,
          segments: [{ closed: false, polyline: [{ x: 1, y: 1 }, { x: 5, y: 1 }] }],
        },
      ],
    },
    { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'none' },
  );

  expect(gcode).not.toMatch(/^M[789]$/m);
});
```

Expected: FAIL until the types compile.

- [ ] **Step 2: Write air-enabled line/fill/raster tests**

Add assertions:

```ts
expect(gcode).toContain('\nM8\n');
expect(gcode).toContain('\nM9\n');
expect(gcode.indexOf('\nM8\n')).toBeLessThan(gcode.indexOf('\nG0 X'));
expect(gcode.lastIndexOf('\nM9\n')).toBeLessThan(gcode.lastIndexOf('\nG0 X0.000 Y0.000 S0'));
```

For raster, assert:

```ts
expect(gcode.indexOf('\nM8\n')).toBeLessThan(gcode.indexOf('\nM4 S0\n'));
expect(gcode.lastIndexOf('\nM9\n')).toBeGreaterThan(gcode.lastIndexOf('\nM5\n'));
```

Expected: FAIL until emitter logic exists.

- [ ] **Step 3: Add coolant helpers**

In `src/core/output/grbl-strategy.ts`, add:

```ts
type CoolantMode = 'off' | 'M7' | 'M8';

function groupCoolantMode(group: Group, device: DeviceProfile): CoolantMode {
  if (!group.airAssist) return 'off';
  return device.airAssistCommand === 'none' ? 'off' : device.airAssistCommand;
}

function coolantTransition(from: CoolantMode, to: CoolantMode): string {
  if (from === to) return '';
  if (to === 'off') return `M9${LINE_END}`;
  if (from !== 'off') return `M9${LINE_END}${to}${LINE_END}`;
  return `${to}${LINE_END}`;
}
```

- [ ] **Step 4: Wrap group emission**

In `emitJob`, add:

```ts
let coolant: CoolantMode = 'off';
```

Before `parts.push(emitAnyGroup(group, device));`, add:

```ts
const nextCoolant = groupCoolantMode(group, device);
parts.push(coolantTransition(coolant, nextCoolant));
coolant = nextCoolant;
```

Before postamble, add:

```ts
parts.push(coolantTransition(coolant, 'off'));
```

Do not put `M7`/`M8` inside `emit-raster.ts`; keep coolant control at the strategy layer so all group kinds share one modal state machine.

- [ ] **Step 5: Preserve laser-off travel invariant**

Run existing G-code invariant tests:

```powershell
corepack pnpm vitest run src/core/output/grbl-strategy.test.ts src/io/gcode/emit-gcode.snapshot.test.ts src/core/preflight/preflight.test.ts
```

Expected: PASS. If snapshots change for air-disabled fixtures, stop: default output changed and must be fixed.

### Task 5: Add Stop/Disconnect Coolant Cleanup

**Files:**
- Modify `src/core/controllers/grbl/commands.ts`
- Modify `src/ui/state/laser-job-actions.ts`
- Modify `src/ui/state/laser-store-helpers.ts`
- Modify `src/ui/state/laser-store.test.ts`

- [ ] **Step 1: Add command constant**

In `src/core/controllers/grbl/commands.ts`, add:

```ts
/** Coolant / air assist off. Normal queued G-code line, not a realtime byte. */
export const CMD_COOLANT_OFF = 'M9';
```

- [ ] **Step 2: Write stop cleanup test**

In `src/ui/state/laser-store.test.ts`, add:

```ts
it('sends coolant off during normal Stop cleanup when serial is alive', async () => {
  const writes: string[] = [];
  installConnectedPort({
    write: async (chunk) => {
      writes.push(chunk);
    },
  });
  await useLaserStore.getState().startJob('G21\nM8\nG1 X1 F600 S100\nM9\nM5\n');

  await useLaserStore.getState().stopJob();

  expect(writes.join('')).toContain('\x18');
  expect(writes.join('')).toContain('M9\n');
});
```

Expected: FAIL until stop cleanup sends `M9`.

- [ ] **Step 3: Implement best-effort stop cleanup**

In `src/ui/state/laser-job-actions.ts`, import `CMD_COOLANT_OFF` and after soft reset write:

```ts
try {
  await safeWrite(`${CMD_COOLANT_OFF}\n`, 'stop');
} catch {
  // Soft reset is the safety-critical command; coolant cleanup is best effort
  // and will fail if the serial link is already gone.
}
```

Keep the existing `RT_SOFT_RESET` first. Do not let a failed `M9` prevent the streamer from being cancelled after the reset succeeded.

- [ ] **Step 4: Update disconnect cleanup**

In `src/ui/state/laser-store-helpers.ts`, change `disconnectStopCommand` so an active job returns:

```ts
`${RT_SOFT_RESET}${CMD_COOLANT_OFF}\n`
```

If command mixing causes Web Serial write issues in tests, use two writes in `laser-store.ts` instead. The invariant is: while connected and an active job exists, LaserForge attempts soft reset and coolant off before closing.

- [ ] **Step 5: Verify Task 5**

Run:

```powershell
corepack pnpm vitest run src/ui/state/laser-store.test.ts src/ui/state/laser-store-active-job-command-guard.test.ts src/ui/state/laser-store-motion-operation.test.ts
```

Expected: PASS.

### Task 6: Wire Cut Settings UI

**Files:**
- Modify `src/ui/layers/cut-settings-draft.ts`
- Modify `src/ui/layers/cut-settings-draft.test.ts`
- Modify `src/ui/layers/CutSettingsCommonFields.tsx`
- Modify `src/ui/layers/CutSettingsDialog.tsx`
- Modify `src/ui/layers/CutsLayersPanel.cut-settings.test.tsx`

- [ ] **Step 1: Write failing draft parser test**

Add to `src/ui/layers/cut-settings-draft.test.ts`:

```ts
it('reads air assist checkbox from the shared cut settings form', () => {
  const layer = createLayer({ id: 'L1', color: '#000000' });
  const form = new FormData();
  form.set('mode', 'line');
  form.set('power', '30');
  form.set('speed', '1500');
  form.set('passes', '1');
  form.set('visible', 'on');
  form.set('output', 'on');
  form.set('airAssist', 'on');

  expect(readCutSettingsPatch(form, layer).airAssist).toBe(true);
});
```

Expected: FAIL until parser handles `airAssist`.

- [ ] **Step 2: Parse airAssist**

In `readCutSettingsPatch`, add:

```ts
airAssist: data.has('airAssist'),
```

- [ ] **Step 3: Add checkbox to shared fields**

In `CutSettingsCommonFields.tsx`, add after Output:

```tsx
<Field label="Air">
  <input
    name="airAssist"
    type="checkbox"
    className="lf-checkbox"
    defaultChecked={props.layer.airAssist}
    title="Turn on air assist for this layer when the device profile is configured for M7 or M8."
  />
</Field>
```

- [ ] **Step 4: Verify dialog behavior**

Run:

```powershell
corepack pnpm vitest run src/ui/layers/cut-settings-draft.test.ts src/ui/layers/CutsLayersPanel.cut-settings.test.tsx
```

Expected: PASS.

### Task 7: Wire Device Settings UI

**Files:**
- Modify `src/ui/laser/DeviceSettings.tsx`
- Modify `src/ui/laser/LaserWindow.test.tsx` or create `src/ui/laser/DeviceSettings.test.tsx`

- [ ] **Step 1: Write failing UI test**

Create `src/ui/laser/DeviceSettings.test.tsx` if no focused file exists:

```tsx
it('lets the operator choose the GRBL air assist command', async () => {
  render(<DeviceSettings />);
  await userEvent.click(screen.getByText('Device'));

  const select = screen.getByLabelText('Air assist command');
  await userEvent.selectOptions(select, 'M8');

  expect(useStore.getState().project.device.airAssistCommand).toBe('M8');
});
```

Expected: FAIL until the select exists.

- [ ] **Step 2: Add the select**

In `DeviceSettings.tsx`, add near `$32 laser mode`:

```tsx
<Row label="Air assist">
  <select
    value={device.airAssistCommand}
    onChange={(e) =>
      update({ airAssistCommand: e.target.value as DeviceProfile['airAssistCommand'] })
    }
    aria-label="Air assist command"
    title="Choose the GRBL coolant command wired to your air assist. Leave Disabled unless you have tested the output."
  >
    <option value="none">Disabled</option>
    <option value="M8">M8 flood coolant</option>
    <option value="M7">M7 mist coolant</option>
  </select>
</Row>
```

If `DeviceProfile` is not in scope, import it type-only:

```ts
import type { DeviceProfile, Origin } from '../../core/devices';
```

- [ ] **Step 3: Verify device UI**

Run:

```powershell
corepack pnpm vitest run src/ui/laser/DeviceSettings.test.tsx src/ui/laser/LaserWindow.test.tsx
```

Expected: PASS.

### Task 8: Include Air Assist in Defaults and Material Library

**Files:**
- Modify `src/ui/layers/layer-default-settings.ts`
- Modify `src/ui/layers/layer-default-settings.test.ts`
- Modify `src/core/material-library/*`
- Modify `src/io/material-library/material-library-io.ts`
- Modify `src/io/material-library/material-library-io.test.ts`
- Modify `src/ui/state/material-library-actions.test.ts`

- [ ] **Step 1: Verify layer defaults include the new field**

Add to `src/ui/layers/layer-default-settings.test.ts`:

```ts
it('captures air assist in layer defaults', () => {
  const layer = { ...createLayer({ id: 'L1', color: '#000000' }), airAssist: true };

  expect(captureLayerDefaultSettings(layer).airAssist).toBe(true);
});
```

Expected: PASS if defaults capture uses rest syntax. If it fails, update the manual list.

- [ ] **Step 2: Extend material recipe if recipes enumerate layer fields**

Search:

```powershell
rg "MaterialRecipe|normalizeMaterialRecipe|recipe" src/core/material-library src/ui/state/material-library-actions.ts -n
```

If `MaterialRecipe` manually lists backed layer settings, add:

```ts
readonly airAssist?: boolean;
```

and normalize missing values to `false` only when assigning to a layer, not when preserving old library files.

- [ ] **Step 3: Include device hint**

In `src/io/material-library/material-library-io.ts`, add to `MaterialLibraryDeviceHint`:

```ts
readonly airAssistCommand: DeviceProfile['airAssistCommand'];
```

Add in `createMaterialLibraryDeviceHint` and `canonicalDeviceHint`:

```ts
airAssistCommand: device.airAssistCommand,
```

Allow optional parsing for old `.lfml.json` files by defaulting missing hint values to `'none'`.

- [ ] **Step 4: Verify material library**

Run:

```powershell
corepack pnpm vitest run src/io/material-library/material-library-io.test.ts src/ui/state/material-library-actions.test.ts src/ui/layers/layer-default-settings.test.ts
```

Expected: PASS.

### Task 9: Output Parity and End-to-End Tests

**Files:**
- Modify or create `src/ui/layers/cut-settings-output-parity.test.ts`
- Modify `src/io/gcode/emit-gcode.test.ts`
- Modify `src/io/gcode/prepare-output.test.ts`

- [ ] **Step 1: Add output parity test**

Add:

```ts
it('cut settings air assist changes only coolant commands in emitted output', () => {
  const off = prepareOutput(projectWith({ airAssist: false, airAssistCommand: 'M8' }));
  const on = prepareOutput(projectWith({ airAssist: true, airAssistCommand: 'M8' }));

  expect(off.kind).toBe('ok');
  expect(on.kind).toBe('ok');
  if (off.kind !== 'ok' || on.kind !== 'ok') return;

  expect(off.gcode).not.toMatch(/^M8$/m);
  expect(on.gcode).toMatch(/^M8$/m);
  expect(on.gcode).toMatch(/^M9$/m);
  expect(stripCoolant(on.gcode)).toBe(stripCoolant(off.gcode));
});

function stripCoolant(gcode: string): string {
  return gcode
    .split('\n')
    .filter((line) => !['M7', 'M8', 'M9'].includes(line.trim()))
    .join('\n');
}
```

Expected: FAIL until all paths are wired.

- [ ] **Step 2: Verify Start/Frame/Save shared path**

Run:

```powershell
corepack pnpm vitest run src/io/gcode/emit-gcode.test.ts src/io/gcode/prepare-output.test.ts src/ui/layers/cut-settings-output-parity.test.ts
```

Expected: PASS.

### Task 10: Full Audit and Browser Smoke

**Files:**
- No code changes unless tests reveal a bug.

- [ ] **Step 1: Run focused verification**

Run:

```powershell
corepack pnpm vitest run src/core/devices/device-profile.test.ts src/core/scene/layer.test.ts src/io/project/project.test.ts src/core/job/compile-job.test.ts src/core/output/grbl-strategy.test.ts src/ui/layers/cut-settings-draft.test.ts src/ui/layers/CutsLayersPanel.cut-settings.test.tsx src/ui/laser/DeviceSettings.test.tsx src/ui/state/laser-store.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full gates**

Run:

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm check:file-size
corepack pnpm test
corepack pnpm build:web
```

Expected:

- typecheck PASS
- lint PASS except documented pre-existing boundary warning if still present
- format PASS
- file-size PASS
- tests PASS
- build PASS, with only known Vite chunk warning if unchanged

- [ ] **Step 3: Browser smoke**

Run local dev server:

```powershell
corepack pnpm dev -- --host 127.0.0.1
```

Smoke in browser:

1. Open Device panel.
2. Confirm Air assist defaults to Disabled.
3. Change Air assist to M8.
4. Open Cut Settings.
5. Toggle Air Assist on for a layer.
6. Save G-code.
7. Verify exported G-code includes `M8` before layer motion and `M9` before end.
8. Change device Air assist back to Disabled.
9. Export again and verify no `M7`, `M8`, or `M9` coolant lines were added.

- [ ] **Step 4: Hardware verification checklist**

Do not call the lane fully proven until this is tested on scrap:

1. With Air assist Disabled, run a tiny known-good job and confirm output behaves exactly like before.
2. In Console, on the target controller only, send `M8`, verify the air relay/pump activates, then send `M9`, verify it turns off.
3. If `M8` does nothing, test `M7` only if the controller documentation says mist coolant is enabled.
4. Run a 10 mm square on scrap with layer Air Assist on; confirm air starts before first burn and stops after job end.
5. Press Stop during an air-enabled scrap job; confirm LaserForge attempts Stop and the air turns off if the serial link is alive.
6. Pulling USB cannot be software-fixed after the link is gone; if air remains on, use the physical switch/power cutoff.

## Plan Audit

- LightBurn parity: matches LightBurn’s split between a layer Air Assist toggle and a device M7/M8 choice.
- GRBL correctness: treats coolant as a separate modal group and uses `M9` for off transitions.
- Safety: default disabled, explicit hardware verification, and Stop/disconnect cleanup included because feed hold does not disable coolant.
- Scope control: no pressure/PWM/material automation or geometry changes.
- Regression control: default output must remain byte-identical except for type/schema JSON adding default fields; G-code must not change until `airAssistCommand !== 'none'` and `layer.airAssist === true`.
- Risk: adding `M9` after soft reset may be rejected if the controller enters Alarm. That is acceptable only if the soft reset was already sent and the UI records/warns on write failure. Tests must pin that failure path.

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-06-16-lane-6c-air-assist.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

