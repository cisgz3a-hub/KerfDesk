// handleSaveTiledGcode honors the output scope: "Cut selected graphics" must
// filter tiled exports exactly like the single-file path (audit finding #29).

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_TILING,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
} from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { handleSaveTiledGcode } from './save-tiled-gcode';

function squareObject(id: string, color: string, at: number): SceneObject {
  const size = 20;
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: at, minY: at, maxX: at + size, maxY: at + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: at, y: at },
              { x: at + size, y: at },
              { x: at + size, y: at + size },
              { x: at, y: at + size },
            ],
          },
        ],
      },
    ],
  };
}

function tiledCncProject(): Project {
  const base = createProject();
  return {
    ...base,
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tiling: DEFAULT_CNC_TILING },
    scene: {
      objects: [squareObject('O1', '#ff0000', 10), squareObject('O2', '#0000ff', 60)],
      layers: [
        // Explicit outside cuts: the maxX assertions below expect the tool to
        // reach past the square's edge (ADR-256 made on-path the default).
        {
          ...createLayer({ id: 'L1', color: '#ff0000' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside' as const },
        },
        {
          ...createLayer({ id: 'L2', color: '#0000ff' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside' as const },
        },
      ],
    },
  };
}

function capturingPlatform(written: string[]): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => ({
      displayName: 'tile.gcode',
      write: async (data: string | Blob) => {
        if (typeof data === 'string') written.push(data);
      },
    }),
    serial: { isSupported: () => false },
    // The tiled save path touches only pickFileForSave; the rest of the
    // adapter surface is irrelevant to this test.
  } as unknown as PlatformAdapter;
}

// Cutter compensation shifts exact coordinates, so assert on X ranges:
// O1 motion stays under ~35 mm; O2 motion reaches past ~55 mm.
function maxX(gcode: string): number {
  const xs = [...gcode.matchAll(/X(-?\d+\.\d+)/g)].map((match) => Number(match[1]));
  return xs.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...xs);
}

describe('handleSaveTiledGcode', () => {
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
});
