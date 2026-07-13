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
        { ...createLayer({ id: 'L1', color: '#ff0000' }), cnc: DEFAULT_CNC_LAYER_SETTINGS },
        { ...createLayer({ id: 'L2', color: '#0000ff' }), cnc: DEFAULT_CNC_LAYER_SETTINGS },
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

  // GCO-02 (Codex M-04): the tiled path must run the same controller-readiness
  // gate as single-file Save. $32=1 (laser mode) on a CNC controller is a
  // blocking plunge hazard; declining the confirm must write NO tiles.
  it('writes no tiles when controller readiness fails and the user declines', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const written: string[] = [];
    const handled = await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project: tiledCncProject(),
      savedName: 'job',
      // $30 matches spindle max (12000) but $32=1 → cncReadiness blocking error.
      controllerSettings: { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: true },
      pushToast: () => undefined,
    });

    expect(handled).toBe(true);
    expect(written).toHaveLength(0);
    confirmSpy.mockRestore();
  });

  it('writes tiles when the connected controller passes readiness', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const written: string[] = [];
    await handleSaveTiledGcode({
      platform: capturingPlatform(written),
      project: tiledCncProject(),
      savedName: 'job',
      // Router mode ($32=0) + matching $30 → readiness ok, confirm never asked.
      controllerSettings: { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: false },
      pushToast: () => undefined,
    });

    expect(written.length).toBeGreaterThan(0);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
