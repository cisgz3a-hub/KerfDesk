// Perceptual DEPTH invariant for the v-carve ladder (ADR-025 pattern).
//
// Every existing v-carve probe measures COVERAGE — "did any cut land in this
// cell" — which cannot tell a floor cut to the requested depth from one left
// standing most of a millimetre high. An audit of the ADR-282 landing measured
// 0.74 mm of uncut material at the centre of a plain depth-clamped square while
// coverage read 100 %, and no test in the tree could have failed on it.
//
// The ladder's guarantee is a depth BOUND, not exactness: rings sit one pitch
// apart, and a point between the deepest ring and the medial axis is reached
// only by that ring's cone, so it can sit up to one ring pitch shallow. A
// V-bit cannot flat-bottom a wide pocket at all — that is what the two-stage
// clearing tool (ADR-280) is for. This pins the bound so the gap stays visible
// and a regression that makes it WORSE fails loudly.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { buildToolpath } from '../job';
import { computeRemovalGrid, kernelForTool } from '../sim';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncTool,
  type ImportedSvg,
  type Scene,
  type Vec2,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { vcarveResolutionMm } from './vcarve-ladder';

const VBIT_90: CncTool = {
  id: 'v90',
  name: '90° v-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};
const AT = 50;
const SIZE = 6;
const MAX_DEPTH_MM = 2;
const CELL_MM = 0.02;
// Discretization slack: one grid cell for the sample point plus one for the
// cone kernel's own rasterization.
const GRID_SLACK_MM = 2 * CELL_MM;

function squareScene(): Scene {
  const points: ReadonlyArray<Vec2> = [
    { x: AT, y: AT },
    { x: AT + SIZE, y: AT },
    { x: AT + SIZE, y: AT + SIZE },
    { x: AT, y: AT + SIZE },
  ];
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'O1.svg',
    bounds: { minX: AT, minY: AT, maxX: AT + SIZE, maxY: AT + SIZE },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [{ closed: true, points }] }],
  };
  return {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          // This file's subject is the DEPTH-CLAMPED floor, so the flat cap is
          // explicit: with it off (the ADR-284 default) depthMm stops being a
          // cap and the bit carves to its full cone, which is a different
          // invariant measured by the medial depth-law probes.
          vCarveFlatDepthEnabled: true,
          depthMm: MAX_DEPTH_MM,
          depthPerPassMm: MAX_DEPTH_MM,
          vResolutionMm: 0, // auto: diameter/8 = 0.75 mm
        },
      },
    ],
  };
}

function distToBoundary(p: Vec2, polygon: ReadonlyArray<Vec2>): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a === undefined || b === undefined) continue;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lengthSq = abx * abx + aby * aby;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
    min = Math.min(min, Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby)));
  }
  return min;
}

describe('v-carve floor DEPTH, not just coverage', () => {
  it('never leaves more than one ring pitch of material above the analytic groove', () => {
    const polygon = [
      { x: AT, y: AT },
      { x: AT + SIZE, y: AT },
      { x: AT + SIZE, y: AT + SIZE },
      { x: AT, y: AT + SIZE },
    ].map((point) => toMachineCoords(point, DEFAULT_DEVICE_PROFILE));
    const xs = polygon.map((point) => point.x);
    const ys = polygon.map((point) => point.y);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];

    const job = compileCncJob(squareScene(), DEFAULT_DEVICE_PROFILE, {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [VBIT_90],
      toolId: VBIT_90.id,
    });
    const result = computeRemovalGrid(
      buildToolpath(job),
      {
        originX: minX - 1,
        originY: minY - 1,
        widthMm: maxX - minX + 2,
        heightMm: maxY - minY + 2,
        mmPerCell: CELL_MM,
      },
      kernelForTool(VBIT_90, CELL_MM),
    );
    if (result.kind === 'error') throw new Error(result.reason);
    const grid = result.grid;

    const ringPitchMm = vcarveResolutionMm(0, VBIT_90.diameterMm);
    let worstUnderCutMm = 0;
    let worstOverCutMm = 0;
    let interiorCells = 0;
    let interiorCut = 0;
    for (let cy = 0; cy < grid.heightCells; cy += 1) {
      for (let cx = 0; cx < grid.widthCells; cx += 1) {
        const x = grid.originX + (cx + 0.5) * grid.mmPerCell;
        const y = grid.originY + (cy + 0.5) * grid.mmPerCell;
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        const analyticMm = Math.min(distToBoundary({ x, y }, polygon), MAX_DEPTH_MM);
        const cutMm = -(grid.depth[cy * grid.widthCells + cx] ?? 0);
        worstUnderCutMm = Math.max(worstUnderCutMm, analyticMm - cutMm);
        worstOverCutMm = Math.max(worstOverCutMm, cutMm - analyticMm);
        // The near-edge band is legitimately shallower than one cell can show.
        if (analyticMm < GRID_SLACK_MM) continue;
        interiorCells += 1;
        if (cutMm > 0) interiorCut += 1;
      }
    }

    expect(interiorCells).toBeGreaterThan(0);
    // Companion check only — a few corner cells fall inside the analytic shape
    // but outside the rasterized cone. Coverage is what the sibling probes
    // already assert; the depth bound below is this file's subject.
    expect(interiorCut / interiorCells).toBeGreaterThanOrEqual(0.999);
    // The bound, and the reason this file exists: coverage above says "carved
    // everywhere", while the floor is up to one ring pitch proud of the
    // requested depth. Tightening it needs a clearing tool, not a finer ladder.
    expect(worstUnderCutMm).toBeLessThanOrEqual(ringPitchMm + GRID_SLACK_MM);
    expect(worstUnderCutMm).toBeGreaterThan(0);
    // The gouging direction, which nothing measured before: an undercut-only
    // bound is equally satisfied by a floor cut arbitrarily too DEEP. Under an
    // explicit flat cap the emitted floor must not dive past the analytic
    // groove by more than grid discretization.
    expect(worstOverCutMm).toBeLessThanOrEqual(GRID_SLACK_MM);
  }, 120000);
});
