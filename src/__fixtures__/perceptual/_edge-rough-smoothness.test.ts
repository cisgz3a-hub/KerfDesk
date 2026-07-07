// REALISTIC curve-smoothness audit (2026-07-04). The clean Roboto-B harness
// under-reported faceting: it rasterizes a perfect glyph (0.5%) but the app
// traces a real anti-aliased image through MERGED UI options and measures 2%+.
// This harness reproduces the REAL path: the actual arch logo, traced with the
// app's default merged Edge options, facet measured on curved letters (O/C/S).
// Exports the curved-letter crop as a BMP so the reference potrace binary can
// vectorize the identical input.
//   TRACE_AUDIT=1 pnpm vitest run src/__fixtures__/perceptual/_edge-rough-smoothness.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { Polyline, Vec2 } from '../../core/scene';
import { TRACE_PRESETS } from '../../core/trace';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { decodePngFile } from './png-decode';
import { renderTraceOverlay } from './render-overlay';
import { requiredArchHouseFixtureStatus } from './trace-artifact-runner';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
const REF_DIR = join(OUT_DIR, 'ref');
const FACET_TURN_RAD = (14 * Math.PI) / 180;
const CORNER_TURN_RAD = (55 * Math.PI) / 180;

// The app's DEFAULT merged Edge options (src/ui/trace/trace-options.ts:
// DEFAULT_EDGE_SENSITIVITY=50 -> thresholds 0.074/0.185; DETAIL=68 -> blur 1.2
// joinGap 5; MINIMUM_LINE_PX=3). Replicated here (a perceptual fixture must not
// import from ui/ per the boundary rule) so we trace what the USER traces, not
// the raw preset.
function mergedAppEdgeOptions(): TraceOptions {
  const raw = TRACE_PRESETS['Edge Detection'] as TraceOptions;
  return {
    ...raw,
    edgeLowThresholdRatio: 0.074,
    edgeHighThresholdRatio: 0.185,
    edgeMinLengthPx: 3,
  };
}

// Curved-letter regions of the 1024^2 logo (source px). The ORIGINAL bands
// (2026-07-04) were mislabeled and OVERLAPPING: they straddled letter pairs and
// caught rectilinear glyphs — the "O" band (x620-770) spanned the HOUSE O *and*
// U, the "C" band (x560-660) caught the blocky HOUSE H, the "S" band (x855-940)
// ran off the end of the word past the E. Their 2-7% "curved-letter facet" was
// therefore mostly serifs, terminals and the H's 90deg corners — not smooth
// curve. Retargeted (2026-07-04) to SINGLE isolated pure-curve letters via a
// column-ink scan of the ARCH HOUSE row (y555-660): the HOUSE O is [590,671],
// U is [681,757], S is [769,822]. On these the smooth bowls trace essentially
// perfectly (O = 0%); the residual on S/U lives entirely at their terminals and
// serifs (genuine sharp features), which is where the metric should look.
const CURVED_LETTERS: ReadonlyArray<{ name: string; band: Band }> = [
  { name: 'O', band: { x0: 588, y0: 552, x1: 673, y1: 668 } },
  { name: 'S', band: { x0: 767, y0: 552, x1: 824, y1: 668 } },
  { name: 'U', band: { x0: 679, y0: 552, x1: 759, y1: 668 } },
];

type Band = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

const RUN_TRACE_AUDIT = process.env['TRACE_AUDIT'] === '1';

it.skipIf(!RUN_TRACE_AUDIT)(
  'measures real-logo curved-letter faceting via merged app options',
  { timeout: 120000 },
  () => {
    const fixture = requiredArchHouseFixtureStatus();
    if (fixture.path === null) throw new Error('arch-house fixture missing');
    mkdirSync(REF_DIR, { recursive: true });
    const image = decodePngFile(fixture.path);
    const polylines = traceImageToEdgePaths(image, mergedAppEdgeOptions()).flatMap(
      (p) => p.polylines,
    );

    const lines: string[] = ['--- real-logo curved letters, merged app options ---'];
    for (const letter of CURVED_LETTERS) {
      const inBand = polylines.filter((pl) =>
        pl.points.some(
          (p) =>
            p.x >= letter.band.x0 &&
            p.x <= letter.band.x1 &&
            p.y >= letter.band.y0 &&
            p.y <= letter.band.y1,
        ),
      );
      lines.push(`${letter.name}: ${facetReport(inBand)}`);
      writeFileSync(
        join(OUT_DIR, `rough__${letter.name}.png`),
        cropRender(image, inBand, letter.band),
      );
    }
    writeFileSync(join(OUT_DIR, 'rough__metrics.txt'), `${lines.join('\n')}\n`);

    // Export the O crop as a BMP for the reference potrace binary.
    writeFileSync(
      join(REF_DIR, 'roughO.bmp'),
      encodeBmp24(cropImage(image, CURVED_LETTERS[0]!.band)),
    );
  },
);

function facetReport(polylines: ReadonlyArray<Polyline>): string {
  let steps = 0;
  let facets = 0;
  for (const pl of polylines) {
    const s = densify(pl, 1);
    for (let i = 1; i + 1 < s.length; i += 1) {
      const turn = Math.abs(turnAt(s[i - 1] as Vec2, s[i] as Vec2, s[i + 1] as Vec2));
      if (turn > CORNER_TURN_RAD) continue;
      steps += 1;
      if (turn >= FACET_TURN_RAD) facets += 1;
    }
  }
  const ratio = steps === 0 ? 0 : (facets / steps) * 100;
  const points = polylines.reduce((sum, pl) => sum + pl.points.length, 0);
  return `polylines=${polylines.length} points=${points} facetRatio=${ratio.toFixed(2)}%`;
}

function densify(polyline: Polyline, step: number): Vec2[] {
  const pts =
    polyline.closed && polyline.points[0] !== undefined
      ? [...polyline.points, polyline.points[0]]
      : [...polyline.points];
  const out: Vec2[] = [];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a === undefined || b === undefined) continue;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg < 1e-9) continue;
    let t = carry;
    while (t < seg) {
      out.push({ x: a.x + ((b.x - a.x) * t) / seg, y: a.y + ((b.y - a.y) * t) / seg });
      t += step;
    }
    carry = t - seg;
  }
  return out;
}

function turnAt(prev: Vec2, at: Vec2, next: Vec2): number {
  const a1 = Math.atan2(at.y - prev.y, at.x - prev.x);
  const a2 = Math.atan2(next.y - at.y, next.x - at.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function cropImage(image: RawImageData, band: Band): RawImageData {
  const w = band.x1 - band.x0;
  const h = band.y1 - band.y0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const src = ((band.y0 + y) * image.width + (band.x0 + x)) * 4;
      const dst = (y * w + x) * 4;
      for (let c = 0; c < 4; c += 1) data[dst + c] = image.data[src + c] ?? 255;
    }
  }
  return { width: w, height: h, data };
}

function cropRender(
  image: RawImageData,
  polylines: ReadonlyArray<Polyline>,
  band: Band,
): Uint8Array {
  const cropped = cropImage(image, band);
  const shifted: Polyline[] = polylines.map((pl) => ({
    closed: pl.closed,
    points: pl.points.map((p) => ({ x: p.x - band.x0, y: p.y - band.y0 })),
  }));
  return renderTraceOverlay(cropped, [{ color: '#000000', polylines: shifted }], 6);
}

function encodeBmp24(image: RawImageData): Uint8Array {
  const rowBytes = Math.ceil((image.width * 3) / 4) * 4;
  const out = new Uint8Array(54 + rowBytes * image.height);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, out.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, image.width, true);
  view.setInt32(22, image.height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, rowBytes * image.height, true);
  for (let y = 0; y < image.height; y += 1) {
    const srcRow = image.height - 1 - y;
    for (let x = 0; x < image.width; x += 1) {
      const src = (srcRow * image.width + x) * 4;
      const dst = 54 + y * rowBytes + x * 3;
      out[dst] = image.data[src + 2] ?? 255;
      out[dst + 1] = image.data[src + 1] ?? 255;
      out[dst + 2] = image.data[src] ?? 255;
    }
  }
  return out;
}
