// Phase H.7 multi-tool jobs: per-layer bits, tool-sectioned ordering,
// drill peck cycles, two-stage v-carve clearance, and the emitter's M0
// change blocks. Single-tool jobs must emit byte-identically to pre-H.7
// output (the snapshot corpus pins the exact bytes).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  layerCncTool,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../scene';
import { compileCncJob, isProfileCutType } from './compile-cnc-job';
import { drillPeckPasses } from './drill-peck';

const DEVICE = DEFAULT_DEVICE_PROFILE;
const MACHINE = DEFAULT_CNC_MACHINE_CONFIG;

function squareObject(id: string, color: string, at: number, size: number): ImportedSvg {
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

function layerWith(color: string, cnc: Partial<CncLayerSettings>): Layer {
  return {
    ...createLayer({ id: color, color }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
}

function sceneOf(objects: ImportedSvg[], layers: Layer[]): Scene {
  return { objects, layers };
}

describe('layerCncTool', () => {
  it('resolves the layer bit, falling back to the machine bit for unknown ids', () => {
    expect(layerCncTool(MACHINE, { toolId: 'vb-60' }).id).toBe('vb-60');
    expect(layerCncTool(MACHINE, { toolId: 'nope' }).id).toBe(MACHINE.toolId);
    expect(layerCncTool(MACHINE, {}).id).toBe(MACHINE.toolId);
  });
});

describe('drillPeckPasses', () => {
  it('pecks each closed shape at its bounds center with chip-clear retracts', () => {
    const passes = drillPeckPasses(
      [
        {
          closed: true,
          points: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 },
          ],
        },
      ],
      { depthMm: 4.5, depthPerPassMm: 2 },
    );
    expect(passes).toHaveLength(1);
    const pass = passes[0];
    if (pass?.kind !== 'path3d') throw new Error('peck pass missing');
    for (const point of pass.points) {
      expect(point.x).toBe(15);
      expect(point.y).toBe(15);
    }
    // Depth ladder 2, 4, 4.5 with clears between pecks (not after the last).
    expect(pass.points.map((p) => p.z)).toEqual([-2, 0, -4, 0, -4.5]);
  });

  it('ignores open paths', () => {
    const passes = drillPeckPasses(
      [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      ],
      { depthMm: 3, depthPerPassMm: 3 },
    );
    expect(passes).toHaveLength(0);
  });
});

describe('compileCncJob multi-tool', () => {
  it('carries the layer bit onto groups and keeps per-bit sections contiguous, profiles last', () => {
    const scene = sceneOf(
      [
        squareObject('A', '#111111', 10, 30),
        squareObject('B', '#222222', 60, 30),
        squareObject('C', '#333333', 110, 30),
      ],
      [
        // Profile with the machine default bit — must land LAST.
        layerWith('#111111', { cutType: 'profile-outside', depthMm: 3 }),
        // Pocket with a 1/4in bit.
        layerWith('#222222', { cutType: 'pocket', toolId: 'em-6350', depthMm: 3 }),
        // Engrave with the same 1/4in bit — same section as the pocket.
        layerWith('#333333', { cutType: 'engrave', toolId: 'em-6350', depthMm: 1 }),
      ],
    );
    const job = compileCncJob(scene, DEVICE, MACHINE);
    const cnc = job.groups.filter((group) => group.kind === 'cnc');
    expect(cnc.map((group) => group.toolId)).toEqual(['em-6350', 'em-6350', 'em-3175']);
    expect(cnc.map((group) => group.toolName?.includes('1/4'))).toEqual([true, true, false]);
    expect(isProfileCutType(cnc.at(-1)?.cutType ?? 'pocket')).toBe(true);
  });

  it('drill groups pin the cut feed to the plunge feed', () => {
    const scene = sceneOf(
      [squareObject('A', '#111111', 10, 20)],
      [
        layerWith('#111111', {
          cutType: 'drill',
          depthMm: 3,
          feedMmPerMin: 1000,
          plungeMmPerMin: 200,
        }),
      ],
    );
    const job = compileCncJob(scene, DEVICE, MACHINE);
    const drill = job.groups.find((group) => group.kind === 'cnc' && group.cutType === 'drill');
    if (drill?.kind !== 'cnc') throw new Error('drill group missing');
    expect(drill.feedMmPerMin).toBe(200);
    expect(drill.passes[0]?.kind).toBe('path3d');
  });

  it('two-stage v-carve emits a clearance pocket with the clearing bit before the ladder', () => {
    const scene = sceneOf(
      [squareObject('A', '#111111', 10, 60)],
      [
        layerWith('#111111', {
          cutType: 'v-carve',
          toolId: 'vb-60',
          vClearToolId: 'em-3175',
          depthMm: 3,
        }),
      ],
    );
    const job = compileCncJob(scene, DEVICE, MACHINE);
    const cnc = job.groups.filter((group) => group.kind === 'cnc');
    expect(cnc).toHaveLength(2);
    const [clearance, vcarve] = cnc;
    expect(clearance?.cutType).toBe('pocket');
    expect(clearance?.toolId).toBe('em-3175');
    expect(vcarve?.cutType).toBe('v-carve');
    expect(vcarve?.toolId).toBe('vb-60');
  });

  it('a shape too narrow for a flat floor produces no clearance stage', () => {
    // 3 mm deep 60° v-carve clamps at inset 3·tan(30°) ≈ 1.73 mm; a 3 mm
    // square offsets away entirely at that inset.
    const scene = sceneOf(
      [squareObject('A', '#111111', 10, 3)],
      [
        layerWith('#111111', {
          cutType: 'v-carve',
          toolId: 'vb-60',
          vClearToolId: 'em-3175',
          depthMm: 3,
        }),
      ],
    );
    const job = compileCncJob(scene, DEVICE, MACHINE);
    const cnc = job.groups.filter((group) => group.kind === 'cnc');
    expect(cnc.every((group) => group.cutType !== 'pocket')).toBe(true);
  });
});

describe('cncGrblStrategy tool changes', () => {
  function emit(scene: Scene): string {
    return cncGrblStrategy.emit(compileCncJob(scene, DEVICE, MACHINE), DEVICE);
  }

  it('inserts one M0 change block between bit sections with re-zero guidance', () => {
    const scene = sceneOf(
      [squareObject('A', '#111111', 10, 30), squareObject('B', '#222222', 60, 30)],
      [
        layerWith('#111111', { cutType: 'pocket', toolId: 'em-3175', depthMm: 2 }),
        layerWith('#222222', { cutType: 'engrave', toolId: 'em-6350', depthMm: 1 }),
      ],
    );
    const gcode = emit(scene);
    const m0Count = gcode.split('\n').filter((line) => line === 'M0').length;
    expect(m0Count).toBe(1);
    expect(gcode).toContain('; tool: 3.175 mm (1/8") end mill (load before starting)');
    expect(gcode).toContain('; tool change: load 6.35 mm (1/4") end mill');
    expect(gcode).toContain('; re-zero Z on the stock top');
    // The change block parks at origin with the spindle off before pausing.
    const lines = gcode.split('\n');
    const m0Index = lines.indexOf('M0');
    expect(lines.slice(0, m0Index)).toContain('M5');
    // Spindle restarts after the pause.
    expect(lines.slice(m0Index + 1).some((line) => line.startsWith('M3 S'))).toBe(true);
  });

  it('re-establishes safe Z as the first motion after an M0 tool change', () => {
    // After M0 the operator re-zeros Z with the new bit, so the program's
    // physical Z is unknown at resume; the first motion must be a G0 Z lift
    // to safe height — never a bare XY rapid with the spindle running.
    const scene = sceneOf(
      [squareObject('A', '#111111', 10, 30), squareObject('B', '#222222', 60, 30)],
      [
        layerWith('#111111', { cutType: 'pocket', toolId: 'em-3175', depthMm: 2 }),
        layerWith('#222222', { cutType: 'engrave', toolId: 'em-6350', depthMm: 1 }),
      ],
    );
    const lines = emit(scene).split('\n');
    const m0Index = lines.indexOf('M0');
    expect(m0Index).toBeGreaterThan(0);
    const firstMotion = lines
      .slice(m0Index + 1)
      .find((line) => line.startsWith('G0') || line.startsWith('G1'));
    expect(firstMotion).toMatch(/^G0 Z/);
  });

  it('single-bit jobs contain no M0 and no tool comments', () => {
    const scene = sceneOf(
      [squareObject('A', '#111111', 10, 30)],
      [layerWith('#111111', { cutType: 'pocket', depthMm: 2 })],
    );
    const gcode = emit(scene);
    expect(gcode.split('\n').filter((line) => line === 'M0')).toHaveLength(0);
    expect(gcode).not.toContain('; tool:');
    expect(gcode).not.toContain('tool change');
  });
});
