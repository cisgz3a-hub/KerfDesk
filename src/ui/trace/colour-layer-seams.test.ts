// Shared colour boundaries survive laser conditioning and compile flattening
// (ADR-430 on top of ADR-391): curved, anti-aliased seams between inks stay
// free of gaps and overlaps in the moves the machine would run.
import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ColoredPath, type TracedImage } from '../../core/scene';
import { boundsFromColoredPaths } from '../../core/trace';
import { compilationPolylines } from '../../core/job/compilation-polylines';
import {
  coverageStats,
  render,
  trace,
  type Rgb,
} from '../../core/trace/colour-layer-trace.test-support';
import { conditionTracedImageForMachine } from './trace-machine-conditioning';
import { TRACE_PRESETS } from '../../core/trace';

const WIDTH = 72;
const HEIGHT = 56;
const PAPER: Rgb = [255, 255, 255];

// Two overlapping discs over a diagonal band: red/blue meet on a circular
// arc, the band meets both discs on arcs and runs off at 45 degrees.
function inkAt(x: number, y: number): Rgb {
  if (Math.hypot(x - 46, y - 28) <= 13) return [30, 50, 200];
  if (Math.hypot(x - 28, y - 26) <= 15) return [210, 40, 40];
  if (Math.abs(x - y - 12) <= 5 && x > 6 && x < 68) return [40, 150, 60];
  return PAPER;
}

// Every point within 2 px of the sample is ink: seams between inks count,
// the outline against the paper is judged by the area tests elsewhere.
function deepInInk(x: number, y: number): boolean {
  if (inkAt(x, y) === PAPER) return false;
  for (let k = 0; k < 16; k += 1) {
    const a = (k * Math.PI) / 8;
    if (inkAt(x + 2 * Math.cos(a), y + 2 * Math.sin(a)) === PAPER) return false;
  }
  return true;
}

function compiledInPixels(traced: TracedImage, mmPerPx: number): ColoredPath[] {
  const placement = { ...IDENTITY_TRANSFORM, scaleX: mmPerPx, scaleY: mmPerPx };
  const options = TRACE_PRESETS['Colour layers']!;
  const conditioned = conditionTracedImageForMachine(traced, placement, 'laser', { options });
  // Compile flattens in the object's local (pixel) units at the placement's
  // tolerance, so the result is measured on the same pixel grid.
  return conditioned.paths.map((path) => ({
    color: path.color,
    polylines: compilationPolylines(path, placement),
  }));
}

describe('colour-layer seams after laser conditioning', () => {
  const paths = trace(render(WIDTH, HEIGHT, inkAt));
  const traced: TracedImage = {
    kind: 'traced-image',
    id: 'seams',
    source: 'seams.png',
    traceMode: 'filled-contours',
    bounds: boundsFromColoredPaths(paths),
    transform: IDENTITY_TRANSFORM,
    paths,
  };

  it('traces the three inks with curved shared boundaries', () => {
    expect(paths).toHaveLength(3);
    for (const path of paths) {
      expect(path.curves?.some((c) => c.segments.some((s) => s.kind === 'cubic'))).toBe(true);
    }
  });

  it.each([0.1, 0.5])('keeps zero overlap and zero seam gap at %s mm per pixel', (mmPerPx) => {
    const compiled = compiledInPixels(traced, mmPerPx);
    expect(compiled).toHaveLength(3);
    const { counts } = coverageStats(compiled, WIDTH, HEIGHT);
    let overlap = 0;
    let gap = 0;
    let deep = 0;
    let s = 0;
    for (let sy = 0; sy < HEIGHT * 4; sy += 1) {
      for (let sx = 0; sx < WIDTH * 4; sx += 1) {
        const c = counts[s] as number;
        s += 1;
        if (c > 1) overlap += 1;
        if (!deepInInk((sx + 0.5) / 4, (sy + 0.5) / 4)) continue;
        deep += 1;
        if (c === 0) gap += 1;
      }
    }
    expect(deep).toBeGreaterThan(10_000);
    expect(overlap).toBe(0);
    expect(gap).toBe(0);
  });
});
