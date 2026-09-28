import * as three from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { describe, expect, it } from 'vitest';
import { createDetailLines, paintDetailLines } from './detail-lines';
import { COLOR_STRIDE, SHOWN_ATTRIBUTE } from './program-lines';
import { applyDetail, detailLevelFor, mmPerPixel, type DetailTargets } from './scene-detail';

// Four moves along X, each 1 mm; the level draws moves 0-1 and 2-3 as two lines.
const POSITIONS = new Float32Array([
  0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0, 2, 0, 0, 3, 0, 0, 3, 0, 0, 4, 0, 0,
]);
const DETAIL = {
  solidMoves: 4,
  levels: [
    { toleranceMm: 0.1, starts: new Uint32Array([0, 2]), ends: new Uint32Array([1, 3]) },
    { toleranceMm: 0.02, starts: new Uint32Array([0, 2, 3]), ends: new Uint32Array([1, 2, 3]) },
  ],
};

function levels() {
  return createDetailLines(three, LineSegmentsGeometry, POSITIONS, DETAIL);
}

function targets(): DetailTargets {
  const full = { lines: new LineSegmentsGeometry(), ghost: new LineSegmentsGeometry() };
  return {
    lines: { geometry: full.lines },
    ghost: { geometry: full.ghost },
    full,
    levels: levels(),
    moves: 4,
  };
}

describe('simplified drawings (ADR-485)', () => {
  it('draws each run from its first move start to its last move end', () => {
    const [coarse] = levels();
    expect(coarse?.count).toBe(2);
    const start = coarse?.geometry.getAttribute(
      'instanceStart',
    ) as three.InterleavedBufferAttribute;
    const end = coarse?.geometry.getAttribute('instanceEnd') as three.InterleavedBufferAttribute;
    expect([start.getX(0), end.getX(0), start.getX(1), end.getX(1)]).toEqual([0, 2, 2, 4]);
    expect(coarse?.ghostGeometry.getAttribute('instanceStart')).toBe(start);
  });

  it('colours each line from its first and last moves, shown as the first move is', () => {
    const [coarse] = levels();
    const program = new Uint16Array(4 * COLOR_STRIDE);
    program.set([10, 11, 12, 0xffff], 0);
    program.set([20, 21, 22, 0xffff], 1 * COLOR_STRIDE);
    program.set([30, 31, 32, 0], 2 * COLOR_STRIDE);
    program.set([40, 41, 42, 0], 3 * COLOR_STRIDE);
    if (coarse === undefined) throw new Error('no level');
    paintDetailLines([coarse], program);
    expect([...coarse.colors.subarray(0, 8)]).toEqual([10, 11, 12, 0xffff, 20, 21, 22, 0]);
    expect([...coarse.colors.subarray(8, 16)]).toEqual([30, 31, 32, 0, 40, 41, 42, 0]);
    const shown = coarse.geometry.getAttribute(SHOWN_ATTRIBUTE) as three.InterleavedBufferAttribute;
    expect(shown.getX(1)).toBe(0);
  });

  it('picks the coarsest level within half a pixel, or every move', () => {
    const tolerances = DETAIL.levels;
    expect(detailLevelFor(tolerances, 1)).toBe(0);
    expect(detailLevelFor(tolerances, 0.1)).toBe(1);
    expect(detailLevelFor(tolerances, 0.01)).toBe(-1);
    expect(detailLevelFor([], 1)).toBe(-1);
  });

  it('measures a pixel at the nearest part of the job', () => {
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: -5, maxZ: 0 };
    const camera = new three.PerspectiveCamera(90, 1, 0.1, 10_000);
    camera.position.set(50, 50, 100);
    expect(mmPerPixel(camera, bounds, 200)).toBeCloseTo(1);
    camera.zoom = 2;
    expect(mmPerPixel(camera, bounds, 200)).toBeCloseTo(0.5);
    const ortho = new three.OrthographicCamera(-50, 50, 50, -50);
    ortho.zoom = 4;
    expect(mmPerPixel(ortho, bounds, 100)).toBeCloseTo(0.25);
    expect(mmPerPixel(ortho, bounds, 0)).toBe(0);
  });

  it('simplifies the drawn path only while it shows the whole program', () => {
    const view = targets();
    const [coarse, fine] = view.levels;
    const whole = applyDetail(view, { wholePath: true, mmPerPixel: 1 });
    expect(whole).toEqual({ drawn: 2, moves: 4, toleranceMm: 0.1 });
    expect(view.lines.geometry).toBe(coarse?.geometry);
    expect(view.ghost.geometry).toBe(coarse?.ghostGeometry);

    expect(applyDetail(view, { wholePath: false, mmPerPixel: 0.1 })).toBeNull();
    expect(view.lines.geometry).toBe(view.full.lines);
    expect(view.ghost.geometry).toBe(fine?.ghostGeometry);

    expect(applyDetail(view, { wholePath: true, mmPerPixel: 0.01 })).toBeNull();
    expect(view.lines.geometry).toBe(view.full.lines);
    expect(view.ghost.geometry).toBe(view.full.ghost);
  });
});
