// Independent assembled-dimension proof: every generated part is placed in
// 3D from the documented drawing convention and sampled against the box the
// operator ASKED for, re-derived here from the entered dimensions, never
// from deriveBoxDims. The shared-float referees trust deriveBoxDims, so a
// wrong height rule passes them; this suite does not (ADR-106 Amd 1: open
// top walls once stood a whole thickness taller than the entered inner
// height).

import { describe, expect, it } from 'vitest';
import { generateBox, type BoxPanel, type BoxSpec } from './index';

type P3 = { readonly x: number; readonly y: number; readonly z: number };
type Outer = { readonly W: number; readonly D: number; readonly H: number };

const BASE: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

// Height layers around the cavity: bottom + top, bottom only, or bottom +
// lid band + captive top strip.
const HEIGHT_LAYERS: Readonly<Record<BoxSpec['style'], number>> = {
  closed: 2,
  'open-top': 1,
  'slide-lid': 3,
};

function requestedOuter(spec: BoxSpec): Outer {
  if (spec.dimensionMode === 'outer') {
    return { W: spec.widthMm, D: spec.depthMm, H: spec.heightMm };
  }
  const t = spec.thicknessMm;
  return {
    W: spec.widthMm + 2 * t,
    D: spec.depthMm + 2 * t,
    H: spec.heightMm + HEIGHT_LAYERS[spec.style] * t,
  };
}

function dividerStarts(spec: BoxSpec, outer: Outer, axis: 'x' | 'y'): number[] {
  const t = spec.thicknessMm;
  const count = (axis === 'x' ? spec.dividersXCount : spec.dividersYCount) ?? 0;
  const inner = (axis === 'x' ? outer.W : outer.D) - 2 * t;
  const pitch = (inner - count * t) / (count + 1);
  return Array.from({ length: count }, (_, i) => t + (i + 1) * pitch + i * t);
}

// (u, v, w) of a world point in one part's plate frame; w ∈ (0, T) is inside.
function localOf(panel: BoxPanel, p: P3, spec: BoxSpec, outer: Outer): P3 {
  const t = spec.thicknessMm;
  switch (panel.panel) {
    case 'bottom':
      return { x: p.x, y: p.y, z: p.z };
    case 'top':
      return { x: p.x, y: p.y, z: p.z - (outer.H - t) };
    case 'lid':
      return { x: p.x, y: p.y, z: p.z - (outer.H - 2 * t) };
    case 'front':
      return { x: p.x, y: p.z, z: p.y };
    case 'back':
      return { x: p.x, y: p.z, z: p.y - (outer.D - t) };
    case 'left':
      return { x: p.y, y: p.z, z: p.x };
    case 'right':
      return { x: p.y, y: p.z, z: p.x - (outer.W - t) };
    case 'divider': {
      const divider = panel.divider!;
      const start = dividerStarts(spec, outer, divider.axis)[divider.index]!;
      return divider.axis === 'x'
        ? { x: p.y, y: p.z - t, z: p.x - start }
        : { x: p.x, y: p.z - t, z: p.y - start };
    }
  }
}

function inRing(points: ReadonlyArray<{ x: number; y: number }>, u: number, v: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > v !== b.y > v && u < ((b.x - a.x) * (v - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function partContains(panel: BoxPanel, p: P3, spec: BoxSpec, outer: Outer): boolean {
  const local = localOf(panel, p, spec, outer);
  if (local.z <= 0 || local.z >= spec.thicknessMm) return false;
  const u = local.x + panel.offsetMm.x;
  const v = local.y + panel.offsetMm.y;
  let inside = inRing(panel.outline.points, u, v);
  for (const cutout of panel.cutouts) if (inRing(cutout.points, u, v)) inside = !inside;
  return inside;
}

// The slide lid's band [H−2T, H−T] holds the full-width lid (minus its thumb
// notch) up to the posts; the strip band above holds only the side strips.
function slideLidBands(spec: BoxSpec, outer: Outer, p: P3): boolean | null {
  const t = spec.thicknessMm;
  const inX = p.x > t && p.x < outer.W - t;
  if (p.z < outer.H - 2 * t) return null;
  if (p.y > outer.D - t) return true;
  if (p.z >= outer.H - t) return !inX;
  if (p.y >= outer.D - 2 * t) return !inX;
  const notchR = Math.min(8, (outer.W - 2 * t) / 4, (outer.D - 2 * t) / 2);
  return Math.hypot(p.x - outer.W / 2, p.y) > notchR;
}

const between = (value: number, from: number, to: number): boolean => value > from && value < to;

function insideOuterBox(outer: Outer, p: P3): boolean {
  return p.x >= 0 && p.y >= 0 && p.z >= 0 && p.x <= outer.W && p.y <= outer.D && p.z <= outer.H;
}

// Open space inside the walls: up to the top panel, the open rim, or the
// slide lid's channel floor.
function inCavity(spec: BoxSpec, outer: Outer, p: P3): boolean {
  const t = spec.thicknessMm;
  const cavityTop = outer.H - (HEIGHT_LAYERS[spec.style] - 1) * t;
  return between(p.x, t, outer.W - t) && between(p.y, t, outer.D - t) && between(p.z, t, cavityTop);
}

function requestedSolid(spec: BoxSpec, outer: Outer, p: P3): boolean {
  if (!insideOuterBox(outer, p)) return false;
  const band = spec.style === 'slide-lid' ? slideLidBands(spec, outer, p) : null;
  if (band !== null) return band;
  if (!inCavity(spec, outer, p)) return true;
  const t = spec.thicknessMm;
  const inSlab = (coord: number, starts: number[]): boolean =>
    starts.some((start) => between(coord, start, start + t));
  return (
    inSlab(p.x, dividerStarts(spec, outer, 'x')) || inSlab(p.y, dividerStarts(spec, outer, 'y'))
  );
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

type Mismatch = { readonly overlaps: number; readonly voids: number; readonly extras: number };

function sampleAssembly(spec: BoxSpec, samples: number, seed: number): Mismatch {
  const result = generateBox(spec);
  if (result.kind !== 'generated') throw new Error(`not generated: ${JSON.stringify(result)}`);
  const outer = requestedOuter(spec);
  const rand = lcg(seed);
  let overlaps = 0;
  let voids = 0;
  let extras = 0;
  for (let i = 0; i < samples; i += 1) {
    // Sample a margin beyond the requested box so over-tall parts show up.
    const p = {
      x: -2 + rand() * (outer.W + 4),
      y: -2 + rand() * (outer.D + 4),
      z: -2 + rand() * (outer.H + 4 + 2 * spec.thicknessMm),
    };
    const count = result.panels.filter((panel) => partContains(panel, p, spec, outer)).length;
    const wanted = requestedSolid(spec, outer, p);
    if (count > 1) overlaps += 1;
    else if (wanted && count === 0) voids += 1;
    else if (!wanted && count === 1) extras += 1;
  }
  return { overlaps, voids, extras };
}

// A slide lid rejects zero clearance; 0.001 mm keeps its play below the
// sampling resolution without leaving the fitted code path.
function nominal(spec: BoxSpec): BoxSpec {
  return spec.style === 'slide-lid' ? { ...spec, clearanceMm: 0.001 } : spec;
}

const CLEAN: Mismatch = { overlaps: 0, voids: 0, extras: 0 };

describe('assembled box matches the requested dimensions', () => {
  for (const style of ['closed', 'open-top', 'slide-lid'] as const) {
    for (const dimensionMode of ['inner', 'outer'] as const) {
      for (const dividers of [0, 1, 2]) {
        it(`${style}, ${dimensionMode} dimensions, ${dividers} dividers per axis`, () => {
          const spec = nominal({
            ...BASE,
            style,
            dimensionMode,
            dividersXCount: dividers,
            dividersYCount: dividers,
          });
          expect(sampleAssembly(spec, 20_000, 11)).toEqual(CLEAN);
        });
      }
    }
  }

  it('holds across fuzzed stock, finger widths and sizes', () => {
    const rand = lcg(42);
    let checked = 0;
    for (let i = 0; i < 60; i += 1) {
      const t = [1.5, 3, 4, 6, 12, 18][Math.floor(rand() * 6)]!;
      const style = (['closed', 'open-top', 'slide-lid'] as const)[Math.floor(rand() * 3)]!;
      const spec = nominal({
        ...BASE,
        widthMm: 20 + rand() * 300,
        depthMm: 20 + rand() * 300,
        heightMm: 10 + rand() * 200,
        thicknessMm: t,
        targetFingerWidthMm: t * (1 + rand() * 4),
        style,
        dimensionMode: rand() < 0.5 ? 'inner' : 'outer',
        dividersXCount: Math.floor(rand() * 3),
        dividersYCount: Math.floor(rand() * 3),
      });
      if (generateBox(spec).kind !== 'generated') continue;
      checked += 1;
      expect({ index: i, ...sampleAssembly(spec, 4_000, i + 7) }).toEqual({ index: i, ...CLEAN });
    }
    expect(checked).toBeGreaterThan(20);
  });
});
