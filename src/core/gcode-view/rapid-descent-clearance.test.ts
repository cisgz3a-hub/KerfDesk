// Second CNC audit P2-preview-1: since ADR-489 and ADR-520 a deeper pass rapids
// down inside its own already-cut slot, and Program Health called every such
// G0 a "Rapid plunge below Z0". (Test files may import across modules.)
import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../cnc';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { buildGcodeRenderModel } from './gcode-render-model';
import { findProgramIssues } from './program-findings';
import type { GcodeRenderModel } from './render-model-types';

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

function rapidPlunge(lines: ReadonlyArray<string>) {
  return findProgramIssues(model(lines.join('\n'))).find((entry) => entry.id === 'rapid-plunge');
}

// One pass along X10..X60 at Z-3, then back over the same line.
const FIRST_PASS = [
  'G21 G90',
  'M3 S10000',
  'G0 Z5',
  'G0 X10 Y10',
  'G1 Z-3 F300',
  'G1 X60 Y10 F800',
  'G0 Z5',
];

describe('rapid plunge finding and already-cut air', () => {
  it('passes a deeper pass that rapids down into its own slot', () => {
    expect(
      rapidPlunge([...FIRST_PASS, 'G0 X10 Y10', 'G0 Z-2', 'G1 Z-6 F300', 'G1 X60 F800', 'M2']),
    ).toBeUndefined();
  });

  it('passes a descent onto the middle of an earlier cut', () => {
    expect(
      rapidPlunge([...FIRST_PASS, 'G0 X35 Y10', 'G0 Z-3', 'G1 Z-6 F300', 'M2']),
    ).toBeUndefined();
  });

  it('flags a rapid below the earlier cut, beside it, or before it', () => {
    const deeper = rapidPlunge([...FIRST_PASS, 'G0 X10 Y10', 'G0 Z-4', 'G1 Z-6 F300', 'M2']);
    expect(deeper?.count).toBe(1);
    expect(deeper?.detail).toContain('to Z -4.00 mm, where no earlier move has cut that deep');

    expect(rapidPlunge([...FIRST_PASS, 'G0 X10 Y12', 'G0 Z-2', 'G1 Z-6 F300', 'M2'])?.count).toBe(
      1,
    );

    const before = rapidPlunge(['G21 G90', 'M3 S10000', 'G0 X10 Y10', 'G0 Z-2', 'G1 Z-3 F300']);
    expect(before?.count).toBe(1);
  });
});

const SQUARE: ImportedSvg = {
  kind: 'imported-svg',
  id: 'part',
  source: 'part.svg',
  bounds: { minX: 50, minY: 50, maxX: 90, maxY: 90 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 50, y: 50 },
            { x: 90, y: 50 },
            { x: 90, y: 90 },
            { x: 50, y: 90 },
          ],
        },
      ],
    },
  ],
};

function ownProgram(settings: Partial<CncLayerSettings>): string {
  const scene: Scene = {
    objects: [SQUARE],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 6, depthPerPassMm: 2, ...settings },
      },
    ],
  };
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  return cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
}

describe("KerfDesk's own multi-pass programs", () => {
  it.each([
    ['an outside profile', { cutType: 'profile-outside', tabsEnabled: false }],
    ['an offset pocket', { cutType: 'pocket', pocketStrategy: 'offset' }],
    ['a raster pocket', { cutType: 'pocket', pocketStrategy: 'raster-x' }],
  ] as const)('%s rapids into its own cuts without a rapid plunge finding', (_name, settings) => {
    const gcode = ownProgram(settings);

    expect(gcode).toMatch(/^G0 Z-\d/m);
    expect(findProgramIssues(model(gcode)).map((finding) => finding.id)).not.toContain(
      'rapid-plunge',
    );
  });
});
