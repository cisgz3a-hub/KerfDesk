// ADR-140 Amendment 2 (CNC audit v1 F3-P1-1, F3-P2-1): with a finish allowance,
// parts spaced between one cut width and a cut width plus twice the allowance
// share one roughing ring, while each keeps its own finishing ring. Their
// roughing tabs were planned on that merged ring and their finishing tabs on
// whichever part owned it, so each pass cut through the other's bridges and the
// parts came free with the spindle running. An allowance of one cut width or more
// also left a ring of stock standing loose between the two slots.
//
// The check is independent of the planner: it reads the emitted G-code, stamps
// every full-depth cutter position, and flood-fills the stock left in the bottom
// layer from the sheet border (through-cut-hold.test-support.ts).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Polyline,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { loosePiecesMm2 } from './through-cut-hold.test-support';

const BIT_MM = 3.175; // DEFAULT_CNC_MACHINE_CONFIG's 1/8 in end mill
const DEPTH_MM = 6.35;

function rectangle(minX: number, minY: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: minX + width, y: minY },
      { x: minX + width, y: minY + height },
      { x: minX, y: minY + height },
    ],
  };
}

// Two 20 mm lobes joined by a 3.6 mm neck: roughing (1/8 in bit, 0.5 mm
// allowance) splits it into two rings, finishing keeps one.
const DUMBBELL: Polyline = {
  closed: true,
  points: [
    { x: 100, y: 100 },
    { x: 120, y: 100 },
    { x: 120, y: 108.2 },
    { x: 130, y: 108.2 },
    { x: 130, y: 100 },
    { x: 150, y: 100 },
    { x: 150, y: 120 },
    { x: 130, y: 120 },
    { x: 130, y: 111.8 },
    { x: 120, y: 111.8 },
    { x: 120, y: 120 },
    { x: 100, y: 120 },
  ],
};

function grid(columns: number, rows: number, sizeMm: number, gapMm: number): Polyline[] {
  const parts: Polyline[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = (index: number): number => 100 + index * (sizeMm + gapMm);
      parts.push(rectangle(at(column), at(row), sizeMm, sizeMm));
    }
  }
  return parts;
}

function loosePieces(
  polylines: ReadonlyArray<Polyline>,
  settings: Partial<CncLayerSettings>,
): ReadonlyArray<number> {
  const art: ImportedSvg = {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 100, minY: 100, maxX: 200, maxY: 200 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [...polylines] }],
  };
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside' as const,
      depthMm: DEPTH_MM,
      depthPerPassMm: 2,
      tabsEnabled: true,
      tabsPerShape: 4,
      tabWidthMm: 6,
      tabHeightMm: 2,
      cutDirection: 'climb' as const,
      ...settings,
    },
  };
  const job = compileCncJob(
    { objects: [art], layers: [layer] },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
  const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
  return loosePiecesMm2(gcode, { depthMm: DEPTH_MM, cutterDiameterMm: BIT_MM, cellMm: 0.1 });
}

const TWO_PARTS = (gapMm: number): Polyline[] => [
  rectangle(100, 100, 40, 30),
  rectangle(140 + gapMm, 100, 40, 30),
];

describe('finish allowance keeps every part on its tabs (ADR-140 Amendment 2)', () => {
  it.each([3.3, 3.6, 4.1])('holds two parts %s mm apart that share a roughing ring', (gapMm) => {
    expect(loosePieces(TWO_PARTS(gapMm), { finishAllowanceMm: 0.5 })).toEqual([]);
  });

  it('holds them with a 0.1 mm allowance too', () => {
    expect(loosePieces(TWO_PARTS(3.25), { finishAllowanceMm: 0.1 })).toEqual([]);
  });

  it('holds a 3 x 2 grid of 30 mm squares 3.5 mm apart', () => {
    expect(loosePieces(grid(3, 2, 30, 3.5), { finishAllowanceMm: 0.5 })).toEqual([]);
  });

  it('holds both slugs of an inside shape whose neck roughing cannot pass', () => {
    expect(loosePieces([DUMBBELL], { cutType: 'profile-inside', finishAllowanceMm: 0.5 })).toEqual(
      [],
    );
  });

  it('holds the layouts that already held: no allowance, a wide gap, one part', () => {
    expect(loosePieces(TWO_PARTS(3.6), {})).toEqual([]);
    expect(loosePieces(TWO_PARTS(5.2), { finishAllowanceMm: 0.5 })).toEqual([]);
    expect(loosePieces([rectangle(100, 100, 40, 30)], { finishAllowanceMm: 0.5 })).toEqual([]);
  });

  it('measures a part as loose when nothing holds it', () => {
    const pieces = loosePieces(TWO_PARTS(3.6), { finishAllowanceMm: 0.5, tabsEnabled: false });
    // Each 40 x 30 part, give or take the cells its wall touches.
    expect(pieces).toHaveLength(2);
    for (const area of pieces) expect(area).toBeCloseTo(1200, -2);
  });

  it('leaves no ring of stock loose when the allowance is a cut width or more', () => {
    // Without tabs the part itself is meant to come free; nothing else may.
    const pieces = loosePieces([rectangle(100, 100, 40, 30)], {
      finishAllowanceMm: 4,
      tabsEnabled: false,
    });
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toBeCloseTo(1200, -2);
  });
});
