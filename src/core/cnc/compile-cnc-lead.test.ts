import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../scene';
import { cncPassXyPoints } from '../job';
import { pointInPolygon } from '../geometry';
import { compileCncJob } from './compile-cnc-job';

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG; // 1/8 in bit (3.175 mm)

function square(): ImportedSvg {
  const at = 50;
  const size = 100;
  return {
    kind: 'imported-svg',
    id: 'sq',
    source: 'sq.svg',
    bounds: { minX: at, minY: at, maxX: at + size, maxY: at + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#2563eb',
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

function scene(cnc: Partial<CncLayerSettings>): Scene {
  const layer: Layer = {
    ...createLayer({ id: 'op', color: '#2563eb' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
  return { objects: [square()], layers: [layer] };
}

function firstGroupPasses(cnc: Partial<CncLayerSettings>) {
  const group = compileCncJob(scene(cnc), dev, config).groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected a cnc group');
  return group.passes;
}

describe('compileCncJob — ADR-250 profile leads', () => {
  it('bakes lead path3d passes into an outside profile by default', () => {
    const passes = firstGroupPasses({ cutType: 'profile-outside' });
    expect(passes.length).toBeGreaterThan(0);
    expect(passes.some((pass) => pass.kind === 'path3d')).toBe(true);
  });

  it('emits only straight-plunge contour passes when leads are disabled', () => {
    const passes = firstGroupPasses({
      cutType: 'profile-outside',
      profileLead: { shape: 'none' },
    });
    expect(passes.length).toBeGreaterThan(0);
    expect(passes.every((pass) => pass.kind === 'contour')).toBe(true);
  });

  it('leads both roughing and finishing passes when a finish allowance is set', () => {
    // Roughing and finishing are concentric offsets of the same outer boundary,
    // so both share the outer winding and both get an exterior lead — the
    // finishing loop (the clean wall) is NOT mistaken for a nested hole.
    const passes = firstGroupPasses({
      cutType: 'profile-outside',
      finishAllowanceMm: 1,
      depthMm: 4,
      depthPerPassMm: 2,
    });
    expect(passes.length).toBeGreaterThanOrEqual(3);
    expect(passes.every((pass) => pass.kind === 'path3d')).toBe(true);
  });

  it('does not lead an interior hole into the kept part (P1 regression)', () => {
    const hole = [
      { x: 85, y: 85 },
      { x: 115, y: 85 },
      { x: 115, y: 115 },
      { x: 85, y: 115 },
    ];
    const holed: ImportedSvg = {
      kind: 'imported-svg',
      id: 'holed',
      source: 'holed.svg',
      bounds: { minX: 50, minY: 50, maxX: 150, maxY: 150 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#2563eb',
          polylines: [
            {
              closed: true,
              points: [
                { x: 50, y: 50 },
                { x: 150, y: 50 },
                { x: 150, y: 150 },
                { x: 50, y: 150 },
              ],
            },
            { closed: true, points: hole },
          ],
        },
      ],
    };
    const layer: Layer = {
      ...createLayer({ id: 'op', color: '#2563eb' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'profile-outside',
        depthMm: 2,
        depthPerPassMm: 2,
      },
    };
    const group = compileCncJob({ objects: [holed], layers: [layer] }, dev, config).groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected a cnc group');
    const spanX = (pass: (typeof group.passes)[number]) => {
      const xs = cncPassXyPoints(pass).map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    const bySpan = [...group.passes].sort((a, b) => spanX(a) - spanX(b));
    // Smallest span = the hole. Under the climb default (ADR-251) its start
    // rotates to a mid-edge, so the inside-side lead fits and bakes a path3d
    // instead of falling back to a plunge — but the P1 invariant holds either
    // way: every hole-pass point stays inside the hole (the waste slug), never
    // the kept ring. (leadClearsPart in profile-lead-passes enforces this.)
    const holeMachine = hole.map((point) => toMachineCoords(point, dev));
    const holePass = bySpan[0];
    if (holePass === undefined) throw new Error('expected a hole pass');
    for (const point of cncPassXyPoints(holePass)) {
      expect(pointInPolygon(point, holeMachine)).toBe(true);
    }
    // Largest span = the outer boundary with its exterior waste-side lead.
    expect(bySpan[bySpan.length - 1]?.kind).toBe('path3d');
  });
});
