// handleSaveTiledGcode honors the output scope: "Cut selected graphics" must
// filter tiled exports exactly like the single-file path (audit finding #29).

import { describe, expect, it, vi } from 'vitest';
import { flowingVCarveProject } from '../../__fixtures__/flowing-vcarve-project';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_TILING,
} from '../../core/scene';
import { detectMachineJobWarnings } from '../laser/machine-job-warnings';
import { handleSaveTiledGcode } from './save-tiled-gcode';
import { capturingPlatform, tiledCncProject } from './save-tiled-gcode-testing';

// Cutter compensation shifts exact coordinates, so assert on X ranges:
// O1 motion stays under ~35 mm; O2 motion reaches past ~55 mm.
function maxX(gcode: string): number {
  const xs = [...gcode.matchAll(/X(-?\d+\.\d+)/g)].map((match) => Number(match[1]));
  return xs.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...xs);
}

describe('handleSaveTiledGcode', () => {
  // Tiling is CNC-only, so skipping the machine-job advisory set here silenced
  // every CNC warning — stock footprint, tabs, feeds, raster, and the v-carve
  // offset-ladder family — on exactly the machine class they exist for. The
  // operator saw nothing and had no way to know something was worth checking.
  it('surfaces the machine job warnings the single-file save shows', async () => {
    const project = tiledCncProject();
    const expected = detectMachineJobWarnings(project);
    // Guard the fixture: an advisory-free project would pass vacuously.
    expect(expected.length).toBeGreaterThan(0);
    const toasts: string[] = [];

    const handled = await handleSaveTiledGcode({
      platform: capturingPlatform([]),
      project,
      savedName: 'job',
      pushToast: (message) => toasts.push(message),
    });

    expect(handled).toBe(true);
    for (const warning of expected) expect(toasts).toContain(warning);
  });

  it('applies "Cut selected graphics" to tiled exports', async () => {
    const written: string[] = [];
    const handled = await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project: tiledCncProject(),
      savedName: 'job',
      outputScope: {
        cutSelectedGraphics: true,
        useSelectionOrigin: false,
        selectedObjectIds: ['O1'],
      },
      pushToast: () => undefined,
    });

    expect(handled).toBe(true);
    expect(written.length).toBeGreaterThan(0);
    const all = written.join('\n');
    expect(maxX(all)).toBeGreaterThan(20);
    // O2 lives at 60..80 — scoped out, so no tile may reach its territory.
    expect(maxX(all)).toBeLessThan(50);
  });

  it('does not rescan an unselected invalid V-carve during per-tile preflight', async () => {
    const base = tiledCncProject();
    const machine = base.machine;
    if (machine?.kind !== 'cnc') throw new Error('expected CNC project');
    const invalidToolId = 'angleless-v-bit';
    const project = {
      ...base,
      machine: {
        ...machine,
        tools: [
          ...machine.tools,
          {
            id: invalidToolId,
            name: 'Legacy angleless V-bit',
            kind: 'v-bit' as const,
            diameterMm: 3,
          },
        ],
      },
      scene: {
        ...base.scene,
        layers: base.scene.layers.map((layer) =>
          layer.id === 'L2'
            ? {
                ...layer,
                cnc: {
                  ...(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS),
                  cutType: 'v-carve' as const,
                  toolId: invalidToolId,
                },
              }
            : layer,
        ),
      },
    };
    const written: string[] = [];

    const handled = await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project,
      savedName: 'job',
      outputScope: {
        cutSelectedGraphics: true,
        useSelectionOrigin: false,
        selectedObjectIds: ['O1'],
      },
      pushToast: () => undefined,
    });

    expect(handled).toBe(true);
    expect(written.length).toBeGreaterThan(0);
    expect(maxX(written.join('\n'))).toBeLessThan(50);
  });

  // Rule 7 / ADR-228: a pre-emit policy finding stopped refusing the tiled
  // export, so it must now be SHOWN once for the set rather than silently
  // dropped — otherwise the fix trades a refusal for silence.
  it('toasts a pre-emit policy advisory after a successful tiled save', async () => {
    const base = tiledCncProject();
    const written: string[] = [];
    const messages: string[] = [];

    await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project: { ...base, device: { ...base.device, controlledLaserOffTravelFeedMmPerMin: 0 } },
      savedName: 'job',
      pushToast: (message) => messages.push(message),
    });

    expect(written.length).toBeGreaterThan(0);
    expect(messages.filter((m) => m.includes('Controlled laser-off seek feed'))).toHaveLength(1);
  });

  it('shows the actual compiled flowing V-carve depth after a successful tiled save', async () => {
    const base = flowingVCarveProject();
    const machine = base.machine;
    if (machine?.kind !== 'cnc') throw new Error('expected CNC project');
    const written: string[] = [];
    const messages: Array<{ readonly message: string; readonly variant?: string }> = [];

    await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project: {
        ...base,
        machine: { ...machine, tiling: DEFAULT_CNC_TILING },
      },
      savedName: 'flowing-v',
      pushToast: (message, variant) =>
        messages.push(variant === undefined ? { message } : { message, variant }),
    });

    expect(written.length).toBeGreaterThan(0);
    expect(
      messages.some(
        ({ message, variant }) =>
          variant === 'warning' &&
          message.includes('actual compiled V-carve depth') &&
          message.includes('into the spoilboard'),
      ),
    ).toBe(true);
  });

  // Rule 7 / ADR-228, the LAST refusal on this path: emitTileFiles refused the
  // whole set on `!preflight.ok`, and runCncPreflight reports heuristic policy
  // codes (cnc-settings-invalid, no-go-zone-collision, plunged-travel) next to
  // the integrity ones. A negative spindle spin-up delay is a settings
  // judgment, not an inability to produce the program — the tiles must still
  // be written, with the finding surfaced as a warning.
  it('writes every tile when a per-tile preflight reports only a policy finding', async () => {
    const base = tiledCncProject();
    const written: string[] = [];
    const messages: string[] = [];

    await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project: {
        ...base,
        machine: {
          ...DEFAULT_CNC_MACHINE_CONFIG,
          tiling: DEFAULT_CNC_TILING,
          params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, spindleSpinupSec: -1 },
        },
      },
      savedName: 'job',
      pushToast: (message) => messages.push(message),
    });

    expect(written.length).toBeGreaterThan(0);
    expect(messages.filter((m) => m.includes('spin-up delay'))).toHaveLength(1);
  });

  it('writes every tile and warns once for retained secondary-cutter values', async () => {
    const base = tiledCncProject();
    const written: string[] = [];
    const messages: string[] = [];
    const project = {
      ...base,
      scene: {
        ...base.scene,
        layers: base.scene.layers.map((layer) =>
          layer.id === 'L1'
            ? {
                ...layer,
                cnc: {
                  ...(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS),
                  cutType: 'pocket' as const,
                  toolId: 'em-1588',
                  pocketRoughToolId: 'em-6350',
                },
              }
            : layer,
        ),
      },
    };

    await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project,
      savedName: 'job',
      pushToast: (message) => messages.push(message),
    });

    expect(written.length).toBeGreaterThan(0);
    expect(messages.filter((message) => message.includes('secondary bit'))).toHaveLength(1);
  });

  it('exports every layer when no scope is given', async () => {
    const written: string[] = [];
    await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project: tiledCncProject(),
      savedName: 'job',
      pushToast: () => undefined,
    });

    expect(maxX(written.join('\n'))).toBeGreaterThan(55);
  });

  it('writes tiles and discloses that a requested ramp is superseded by the medial profile', async () => {
    const base = tiledCncProject();
    const machine = base.machine;
    if (machine?.kind !== 'cnc') throw new Error('expected CNC project');
    const written: string[] = [];
    const toasts: string[] = [];
    const project = {
      ...base,
      machine: {
        ...machine,
        tiling: {
          tileWidthMm: 70,
          tileHeightMm: 380,
          overlapMm: 0,
          registrationHoles: false,
        },
      },
      scene: {
        ...base.scene,
        layers: base.scene.layers.map((layer) =>
          layer.id === 'L2'
            ? {
                ...layer,
                cnc: {
                  ...(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS),
                  cutType: 'v-carve' as const,
                  toolId: 'vb-60',
                  vCarveRampEntryDeg: 3,
                },
              }
            : layer,
        ),
      },
    };

    const handled = await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project,
      savedName: 'job',
      pushToast: (message) => toasts.push(message),
    });

    expect(handled).toBe(true);
    expect(written.length).toBeGreaterThan(0);
    expect(toasts).toEqual(
      expect.arrayContaining([expect.stringContaining('certified variable-depth profile')]),
    );
    expect(toasts.join('\n')).not.toContain('not a re-verified emitted maximum');
    expect(toasts.join('\n')).not.toContain('direct plunge');
    expect(written.join('\n')).toContain('; cnc entry: medial-profile; max-angle-deg: 3.000');
  }, 15_000);

  it('prepends provenance, machine assumptions, and tile identity to every file', async () => {
    const written: string[] = [];
    await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project: tiledCncProject(),
      savedName: 'job',
      pushToast: () => undefined,
    });

    expect(written.length).toBeGreaterThan(0);
    for (const file of written) {
      expect(file).toContain('; commit:');
      expect(file).toContain('; emitter:');
      expect(file).toContain(`; profile-name: ${tiledCncProject().device.name}`);
      expect(file).toContain(`; profile-id: ${tiledCncProject().device.profileId}`);
      expect(file).toContain('GRBL $30=12000');
      expect(file).toMatch(/; tile: row \d+, column \d+/);
    }
  });

  // GCO-02 (Codex M-04) asserted the opposite: that declining a
  // controller-readiness confirm wrote NO tiles. Rule 7 / ADR-228 names
  // "save … export" and "adds confirmation before an otherwise available
  // action" in the guard definition, and names controller-setting policy as
  // warn-only — so $32=1 on a CNC controller is stated, once for the whole
  // set, and every tile is still written. The plunge hazard it describes is
  // real; refusing the export is not what protects against it.
  it('writes every tile and warns when the controller reports laser mode', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const written: string[] = [];
    const toasts: Array<{ readonly message: string; readonly variant?: string }> = [];
    const handled = await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project: tiledCncProject(),
      savedName: 'job',
      // $30 matches spindle max (12000) but $32=1 → cncReadiness error.
      controllerSettings: { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: true },
      pushToast: (message, variant) => {
        toasts.push(variant === undefined ? { message } : { message, variant });
      },
    });

    expect(handled).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(written.length).toBeGreaterThan(0);
    // Stated ONCE for the set, naming the setting and the hazard.
    const laserModeWarnings = toasts.filter(
      (toast) =>
        toast.variant === 'warning' &&
        toast.message.includes('Controller reports $32=1 (laser mode). Set $32=0 for spindle work'),
    );
    expect(laserModeWarnings).toHaveLength(1);
    confirmSpy.mockRestore();
  });

  it('writes tiles and raises no readiness warning when the controller passes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const written: string[] = [];
    const toasts: string[] = [];
    await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project: tiledCncProject(),
      savedName: 'job',
      // Router mode ($32=0) + matching $30 → readiness ok, nothing to report.
      controllerSettings: { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: false },
      pushToast: (message) => toasts.push(message),
    });

    expect(written.length).toBeGreaterThan(0);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(toasts.some((message) => message.includes('connected controller'))).toBe(false);
    confirmSpy.mockRestore();
  });

  it('reports an incomplete read-only settings dump without refusing tile export', async () => {
    const written: string[] = [];
    const toasts: string[] = [];
    await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project: tiledCncProject(),
      savedName: 'job',
      controllerSettings: {},
      settingsCapability: 'readonly-dump',
      pushToast: (message) => toasts.push(message),
    });

    expect(written.length).toBeGreaterThan(0);
    expect(toasts).toContainEqual(expect.stringContaining('settings dump did not include $30'));
  });
});
