// Chord bands for the binary contour tail's spline resample (ADR-482).
//
// Douglas-Peucker collapses a stretch of the dense chain onto each chord of
// the simplified outline. The Catmull-Rom resample through those vertices
// bows each chord toward its neighbours' turn, up to the simplification
// tolerance on either side: on a binary 2 px bar that bow alone made each
// long side sit ~0.5 px outside the ink (+49% area). The band of a chord
// bounds the signed perpendicular offset the resample may take from it:
//
//  - every chord stays within the range of offsets its own dense stretch
//    takes (a stretch on the chord keeps the resample on it);
//  - a long chord also stays on the side its stretch bulges, at most twice
//    the stretch's mean offset (an arc's mean is 2/3 of its sagitta). Along
//    a long straight run staircase and noise wobble average out, so the
//    resample follows the run instead of the wobble's extremes. A short
//    chord's mean mostly says where Douglas-Peucker put its two vertices on
//    that wobble, so there the range alone bounds it: bounding short arcs by
//    their mean made a jittered ring measurably less round.
//
// Own design, pure core.

import type { Vec2 } from '../scene';
import type { ChordBand } from './centerline/curve-fit';

const NEAR_POINT_PX = 1e-9;
// A long chord's band reaches this multiple of its stretch's mean offset.
const BULGE_OF_MEAN = 2;
// Chords from this long (source px) are long: a thin bar's sides, not the
// ~15-30 px chords a simplified ring of radius 60-90 px is made of.
const LONG_CHORD_PX = 32;

/** The band of every chord between consecutive `vertices` of a closed
 *  outline simplified from the closed `dense` ring (offsets along the
 *  chord's left normal, as the resample measures them). Vertices are matched
 *  to dense points by reference; a vertex a later stage moved takes the
 *  nearest dense point between its matched neighbours. A chord whose
 *  vertices do not match gets no band (the resample's own cap still holds). */
export function denseChordBand(
  dense: ReadonlyArray<Vec2>,
  vertices: ReadonlyArray<Vec2>,
  pixelScale = 1,
): ChordBand {
  const n = dense.length;
  const indexOf = matchVertices(dense, vertices);
  const longChord = LONG_CHORD_PX * pixelScale;
  return (a, b) => {
    const from = indexOf.get(a);
    const to = indexOf.get(b);
    if (from === undefined || to === undefined || n < 2) return null;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < NEAR_POINT_PX) return null;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    let low = 0;
    let high = 0;
    // Twice the signed area between the stretch and its chord (shoelace
    // about a; the closing chord b -> a adds none).
    let doubleArea = 0;
    let previous = a;
    const steps = (to - from + n) % n;
    for (let k = 1; k <= steps; k += 1) {
      const p = k === steps ? b : (dense[(from + k) % n] as Vec2);
      const offset = (p.x - a.x) * nx + (p.y - a.y) * ny;
      if (offset < low) low = offset;
      if (offset > high) high = offset;
      doubleArea += (previous.x - a.x) * (p.y - a.y) - (p.x - a.x) * (previous.y - a.y);
      previous = p;
    }
    if (len < longChord) return { below: low, above: high };
    const bulge = (BULGE_OF_MEAN * -doubleArea) / (2 * len);
    return { below: Math.max(low, Math.min(0, bulge)), above: Math.min(high, Math.max(0, bulge)) };
  };
}

// Dense index of each vertex: by reference, else the nearest dense point in
// the stretch between the previous and next matched vertices.
function matchVertices(
  dense: ReadonlyArray<Vec2>,
  vertices: ReadonlyArray<Vec2>,
): Map<Vec2, number> {
  const n = dense.length;
  const byReference = new Map<Vec2, number>();
  dense.forEach((p, i) => byReference.set(p, i));
  const out = new Map<Vec2, number>();
  const known = vertices.map((v) => byReference.get(v));
  const m = vertices.length;
  if (!known.some((i) => i !== undefined)) return out;
  vertices.forEach((v, k) => {
    const exact = known[k];
    if (exact !== undefined) {
      out.set(v, exact);
      return;
    }
    const lo = neighbourIndex(known, k, -1, m);
    const hi = neighbourIndex(known, k, 1, m);
    const span = (hi - lo + n) % n || n;
    let best = lo;
    let bestDistance = Infinity;
    for (let s = 0; s <= span; s += 1) {
      const i = (lo + s) % n;
      const p = dense[i] as Vec2;
      const d = Math.hypot(p.x - v.x, p.y - v.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    out.set(v, best);
  });
  return out;
}

function neighbourIndex(
  known: ReadonlyArray<number | undefined>,
  k: number,
  direction: 1 | -1,
  m: number,
): number {
  for (let step = 1; step <= m; step += 1) {
    const i = known[(k + direction * step + m) % m];
    if (i !== undefined) return i;
  }
  return 0;
}
