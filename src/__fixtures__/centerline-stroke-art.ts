// Analytic stroke art for the centerline curve-output tests (ADR-405). Each
// fixture is dark ink on white whose centreline is known by construction: a
// pixel's coverage is the 4x4-supersampled fraction of its area lying within
// strokeWidth/2 of the analytic centreline, so edges are anti-aliased the way
// scanned and exported art is. Pure, deterministic, test-only.

import type { Polyline, Vec2 } from '../core/scene';
import type { RawImageData } from '../core/trace/trace-image';
import { minDistanceToPolylines } from './perceptual/centerline-geometry';

export type StrokeArt = {
  readonly name: string;
  readonly image: RawImageData;
  /** The analytic centreline(s) the ink was rendered around. */
  readonly centerlines: ReadonlyArray<Polyline>;
  readonly strokeWidthPx: number;
};

const SUPERSAMPLE = 4;
const ARC_STEPS_PER_PX = 2;

export function arcPolyline(
  cx: number,
  cy: number,
  r: number,
  fromDeg: number,
  toDeg: number,
): Vec2[] {
  const sweep = Math.abs(toDeg - fromDeg) * (Math.PI / 180) * r;
  const steps = Math.max(8, Math.ceil(sweep * ARC_STEPS_PER_PX));
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const rad = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    points.push({ x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) });
  }
  return points;
}

function parametric(from: number, to: number, steps: number, at: (t: number) => Vec2): Vec2[] {
  return Array.from({ length: steps + 1 }, (_, i) => at(from + ((to - from) * i) / steps));
}

/** Render the centrelines at the given stroke width with anti-aliased edges. */
export function renderStrokeArt(
  name: string,
  centerlines: ReadonlyArray<Polyline>,
  strokeWidthPx: number,
  width = 128,
  height = width,
): StrokeArt {
  const half = strokeWidthPx / 2;
  const data = new Uint8ClampedArray(width * height * 4);
  const reach = half + 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let covered = 0;
      const centre = minDistanceToPolylines({ x: x + 0.5, y: y + 0.5 }, centerlines);
      if (centre <= reach) {
        for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
          for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
            const p = { x: x + (sx + 0.5) / SUPERSAMPLE, y: y + (sy + 0.5) / SUPERSAMPLE };
            if (minDistanceToPolylines(p, centerlines) <= half) covered += 1;
          }
        }
      }
      const value = Math.round(255 * (1 - covered / (SUPERSAMPLE * SUPERSAMPLE)));
      const base = (y * width + x) * 4;
      data[base] = value;
      data[base + 1] = value;
      data[base + 2] = value;
      data[base + 3] = 255;
    }
  }
  return { name, image: { width, height, data }, centerlines, strokeWidthPx };
}

const open = (points: Vec2[]): Polyline => ({ points, closed: false });
const closed = (points: Vec2[]): Polyline => ({ points, closed: true });

export function ringArt(radius = 50, strokeWidthPx = 3): StrokeArt {
  const ring = arcPolyline(64, 64, radius, 0, 360);
  return renderStrokeArt(`ring r=${radius}`, [closed(ring)], strokeWidthPx);
}

export function sCurveArt(strokeWidthPx = 5): StrokeArt {
  const wave = parametric(0, 1, 400, (t) => ({
    x: 14 + 100 * t,
    y: 64 + 30 * Math.sin(2 * Math.PI * t),
  }));
  return renderStrokeArt('S-curve', [open(wave)], strokeWidthPx);
}

export function letterSArt(strokeWidthPx = 5): StrokeArt {
  const upper = arcPolyline(64, 44, 18, -30, -270);
  const lower = arcPolyline(64, 80, 18, -90, 150);
  return renderStrokeArt('letter S', [open([...upper, ...lower.slice(1)])], strokeWidthPx);
}

export function letter8Art(strokeWidthPx = 5): StrokeArt {
  return renderStrokeArt(
    'letter 8',
    [closed(arcPolyline(64, 43, 17, 0, 360)), closed(arcPolyline(64, 78, 18, 0, 360))],
    strokeWidthPx,
  );
}

export function letterAArt(strokeWidthPx = 5): StrokeArt {
  const hook = arcPolyline(62, 52, 12, -160, 0);
  const stem = [
    { x: 74, y: 52 },
    { x: 74, y: 96 },
  ];
  const bowl = arcPolyline(60, 80, 14, 0, 360);
  return renderStrokeArt(
    'letter a',
    [open([...hook, ...stem.slice(1)]), closed(bowl)],
    strokeWidthPx,
  );
}

/** A looped cursive line (prolate cycloid): smooth strokes with self-crossings. */
export function handwritingArt(strokeWidthPx = 3): StrokeArt {
  const loops = parametric(0.4, 4.6 * Math.PI, 900, (t) => ({
    x: 16 + 6 * t - 9 * Math.sin(t),
    y: 64 + 18 * Math.cos(t),
  }));
  return renderStrokeArt('handwriting', [open(loops)], strokeWidthPx);
}

export function junctionArt(kind: 'T' | 'X' | 'Y', strokeWidthPx = 5): StrokeArt {
  const c = { x: 64, y: 64 };
  const lines: Polyline[] =
    kind === 'T'
      ? [
          open([
            { x: 20, y: 30 },
            { x: 108, y: 30 },
          ]),
          open([
            { x: 64, y: 30 },
            { x: 64, y: 108 },
          ]),
        ]
      : kind === 'X'
        ? [
            open([
              { x: 24, y: 24 },
              { x: 104, y: 104 },
            ]),
            open([
              { x: 104, y: 24 },
              { x: 24, y: 104 },
            ]),
          ]
        : [open([{ x: 28, y: 24 }, c]), open([{ x: 100, y: 24 }, c]), open([c, { x: 64, y: 108 }])];
  return renderStrokeArt(`${kind} junction`, lines, strokeWidthPx);
}

/** A lone round dot of the given radius (disc). Its "centreline" is its centre. */
export function dotArt(radius: number): StrokeArt {
  const centre = { x: 32, y: 32 };
  return renderStrokeArt(`dot r=${radius}`, [open([centre, centre])], radius * 2, 64);
}

/** Two collinear 3 px strokes with flat ends separated by `gapPx` of paper. */
export function gapArt(gapPx: number): { image: RawImageData; gapPx: number } {
  const width = 128;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  const leftEnd = 62;
  const rightStart = leftEnd + gapPx;
  for (let y = 63; y < 66; y += 1) {
    for (let x = 18; x < 110; x += 1) {
      if (x >= leftEnd && x < rightStart) continue;
      data.set([0, 0, 0, 255], (y * width + x) * 4);
    }
  }
  return { image: { width, height: width, data }, gapPx };
}

/** A horizontal capsule (a short dash with round caps) `length` px long
 *  overall and `strokeWidthPx` wide, centred at (64, 64). */
export function capsuleArt(length: number, strokeWidthPx: number): StrokeArt {
  const half = (length - strokeWidthPx) / 2;
  return renderStrokeArt(
    `capsule ${length}x${strokeWidthPx}`,
    [
      open([
        { x: 64 - half, y: 64 },
        { x: 64 + half, y: 64 },
      ]),
    ],
    strokeWidthPx,
  );
}

/** A dashed line: `count` round-capped dashes `dashPx` long overall,
 *  separated by `gapPx` of paper between their caps. */
export function dashedLineArt(
  count: number,
  dashPx: number,
  gapPx: number,
  strokeWidthPx: number,
): StrokeArt {
  const lines: Polyline[] = [];
  let x = 20;
  for (let i = 0; i < count; i += 1) {
    const half = strokeWidthPx / 2;
    lines.push(
      open([
        { x: x + half, y: 64 },
        { x: x + dashPx - half, y: 64 },
      ]),
    );
    x += dashPx + gapPx;
  }
  return renderStrokeArt(`dashes ${dashPx}/${gapPx}x${strokeWidthPx}`, lines, strokeWidthPx);
}

/** A "+" sign `size` px across with round-capped arms. */
export function plusArt(size: number, strokeWidthPx: number): StrokeArt {
  const half = (size - strokeWidthPx) / 2;
  return renderStrokeArt(
    `plus ${size}x${strokeWidthPx}`,
    [
      open([
        { x: 64 - half, y: 64 },
        { x: 64 + half, y: 64 },
      ]),
      open([
        { x: 64, y: 64 - half },
        { x: 64, y: 64 + half },
      ]),
    ],
    strokeWidthPx,
  );
}

/** A small lowercase "e": a bar across a 320 degree arc of radius `r`. */
export function smallEArt(r: number, strokeWidthPx: number): StrokeArt {
  return renderStrokeArt(
    `e r=${r}`,
    [
      open([
        { x: 64 - r, y: 64 },
        { x: 64 + r, y: 64 },
      ]),
      open(arcPolyline(64, 64, r, 0, -320)),
    ],
    strokeWidthPx,
  );
}

/** A small "c": a 270 degree arc of radius `r`. */
export function smallCArt(r: number, strokeWidthPx: number): StrokeArt {
  return renderStrokeArt(`c r=${r}`, [open(arcPolyline(64, 64, r, 45, 315))], strokeWidthPx);
}
