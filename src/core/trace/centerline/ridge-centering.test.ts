// Sub-pixel ridge centring (ADR-394): an even-width stroke's skeleton runs
// half a pixel to one side of the two-pixel ridge; centring moves it onto
// the true centre without touching junctions.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../scene';
import type { RawImageData, TraceOptions } from '../trace-image';
import { squaredDistanceField, type InkMask } from './distance-field';
import { centerGraphOnRidge, peakOffset } from './ridge-centering';
import type { StrokeGraph, StrokeNodeKind } from './stroke-graph';
import { traceCenterlineStrokePaths } from './trace-centerline';

const WIDTH = 60;
const HEIGHT = 16;
const BAR_TOP = 4;

// A horizontal bar `thickness` pixels tall from row BAR_TOP.
function barMask(thickness: number): InkMask {
  const ink = new Uint8Array(WIDTH * HEIGHT);
  for (let y = BAR_TOP; y < BAR_TOP + thickness; y += 1) {
    for (let x = 5; x < 55; x += 1) ink[y * WIDTH + x] = 1;
  }
  return { width: WIDTH, height: HEIGHT, ink };
}

// A skeleton chain along one pixel row, as thinning leaves it.
function rowGraph(row: number, ends: readonly [StrokeNodeKind, StrokeNodeKind]): StrokeGraph {
  const points: Vec2[] = [];
  for (let x = 10; x < 50; x += 1) points.push({ x: x + 0.5, y: row + 0.5 });
  return {
    nodes: [
      { id: 0, pos: points[0]!, kind: ends[0], pixels: [] },
      { id: 1, pos: points.at(-1)!, kind: ends[1], pixels: [] },
    ],
    chains: [{ a: 0, b: 1, points, closed: false }],
  };
}

describe('peakOffset', () => {
  it('puts the peak of a two-pixel plateau midway between its pixels', () => {
    expect(peakOffset(1, 2, 2)).toBe(0.5);
    expect(peakOffset(2, 2, 1)).toBe(-0.5);
  });

  it('keeps the centre pixel of an odd-width stroke', () => {
    expect(peakOffset(1, 2, 1)).toBe(0);
  });

  it('meets two equal slopes between pixel centres', () => {
    expect(peakOffset(1.2, 2, 1.6)).toBeCloseTo(0.25, 12);
  });

  it('refuses a point that is not a ridge maximum', () => {
    expect(peakOffset(3, 2, 1)).toBeNull();
    expect(peakOffset(2, 2, 2)).toBeNull();
  });
});

describe('centerGraphOnRidge', () => {
  it('moves an even-width stroke onto its true centre, tips included', () => {
    // Rows 4-7 are ink, so the centre is y = 6; thinning keeps row 5 (y 5.5).
    const distSq = squaredDistanceField(barMask(4));
    const graph = rowGraph(BAR_TOP + 1, ['endpoint', 'endpoint']);
    const centred = centerGraphOnRidge(graph, distSq, WIDTH);
    const points = centred.chains[0]!.points;
    expect(points.map((p) => p.y)).toEqual(points.map(() => 6));
    expect(points.map((p) => p.x)).toEqual(graph.chains[0]!.points.map((p) => p.x));
    expect(centred.nodes[0]!.pos).toEqual(points[0]);
    expect(centred.nodes[1]!.pos).toEqual(points.at(-1));
  });

  it('leaves an odd-width stroke that is already centred untouched', () => {
    const distSq = squaredDistanceField(barMask(5));
    const graph = rowGraph(BAR_TOP + 2, ['endpoint', 'endpoint']);
    expect(centerGraphOnRidge(graph, distSq, WIDTH)).toBe(graph);
  });

  it('never moves a junction or a former junction', () => {
    const distSq = squaredDistanceField(barMask(4));
    const graph = rowGraph(BAR_TOP + 1, ['endpoint', 'junction']);
    const seam = graph.chains[0]!.points[20]!;
    const centred = centerGraphOnRidge({ ...graph, seamJunctions: [seam] }, distSq, WIDTH);
    const points = centred.chains[0]!.points;
    expect(points.at(-1)).toBe(graph.chains[0]!.points.at(-1));
    expect(centred.nodes[1]).toBe(graph.nodes[1]);
    expect(points[20]).toBe(seam);
    expect(points[10]!.y).toBe(6);
  });
});

describe('even-width strokes trace on their centre', () => {
  it('traces a 4 px ring on its centre circle, not half a pixel to one side', () => {
    // Ink wherever a pixel centre lies within 2 px of a circle of radius 20:
    // four pixels across everywhere, so thinning leaves a two-pixel ridge.
    const size = 80;
    const centre = { x: 40, y: 40 };
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const r = Math.hypot(x + 0.5 - centre.x, y + 0.5 - centre.y);
        if (Math.abs(r - 20) <= 2) data.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
      }
    }
    const image: RawImageData = { width: size, height: size, data };
    const options: TraceOptions = {
      traceMode: 'centerline',
      numberOfColors: 2,
      pathOmit: 0,
      lineTolerance: 1,
      quadraticTolerance: 1,
      blurRadius: 0,
      blurDelta: 0,
      lineFilter: true,
      fixedPalette: ['#ffffff', '#000000'],
      useOtsuThreshold: true,
      despeckleMinPixels: 4,
      centerlineJoinGapPx: 3,
    };
    const polylines = traceCenterlineStrokePaths(image, options).flatMap((p) => p.polylines);
    expect(polylines).toHaveLength(1);
    // Measured: worst 0.13 px, mean 0.06 px (worst 0.57, mean 0.26 before).
    const errors = polylines[0]!.points.map((p) => Math.abs(Math.hypot(p.x - 40, p.y - 40) - 20));
    expect(Math.max(...errors)).toBeLessThan(0.2);
    expect(errors.reduce((sum, e) => sum + e, 0) / errors.length).toBeLessThan(0.1);
  });
});
