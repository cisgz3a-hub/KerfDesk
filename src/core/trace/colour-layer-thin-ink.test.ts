// Thin dark text in a flat-colour logo keeps its own Colour layer, at the
// darkest starting power, through an ordinary JPEG, a slight blur or grain
// (quality audit Q5-P2-2, ADR-461 Amendment 3). Before the amendment the text
// had too few flat pixels left, was dissolved, and burned on the blue square's
// layer at that layer's power. The guards below keep what the amendment must
// not rescue: an ink's edge ramp and the grain piled up at black.
import { describe, expect, it } from 'vitest';
import type { ColoredPath, Vec2 } from '../scene';
import type { RawImageData } from './trace-image';
import { colourLayerSettings } from './colour-layer-power';
import { covers, render, trace, type Rgb } from './colour-layer-trace.test-support';
import { gaussianBlur, jpegRoundTrip, withGrain } from './colour-layer-degrade.test-support';

const W = 400;
const H = 240;
const PAPER: Rgb = [250, 250, 250];
const BLUE: Rgb = [30, 80, 200];

type Segment = readonly [number, number, number, number];

// A straight-stroke font in a 26-unit cell; strokes are capsules.
const GLYPHS: Readonly<Record<string, ReadonlyArray<Segment>>> = {
  K: [
    [2, 0, 2, 26],
    [16, 0, 2, 15],
    [7, 10, 16, 26],
  ],
  E: [
    [2, 0, 2, 26],
    [2, 0, 15, 0],
    [2, 13, 13, 13],
    [2, 26, 15, 26],
  ],
  R: [
    [2, 0, 2, 26],
    [2, 0, 11, 0],
    [11, 0, 15, 4],
    [15, 4, 15, 9],
    [15, 9, 11, 13],
    [11, 13, 2, 13],
    [8, 13, 16, 26],
  ],
  F: [
    [2, 0, 2, 26],
    [2, 0, 15, 0],
    [2, 13, 13, 13],
  ],
  L: [
    [2, 0, 2, 26],
    [2, 26, 15, 26],
  ],
  I: [[8, 0, 8, 26]],
  N: [
    [2, 0, 2, 26],
    [2, 0, 15, 26],
    [15, 0, 15, 26],
  ],
};

type Text = {
  readonly segments: ReadonlyArray<Segment>;
  readonly halfWidth: number;
  /** Bounding box of the strokes: x0, y0, x1, y1. */
  readonly box: readonly [number, number, number, number];
};

// Slanted like an italic, so its edges run at an angle as real type's do.
function text(chars: string, at: { x: number; y: number; scale: number; halfWidth: number }): Text {
  const segments: Segment[] = [];
  [...chars].forEach((ch, i) => {
    const place = (gx: number, gy: number): readonly [number, number] => [
      at.x + 0.3 + (i * 22 + gx + 0.25 * (26 - gy)) * at.scale,
      at.y + 0.4 + gy * at.scale,
    ];
    for (const [ax, ay, bx, by] of GLYPHS[ch] ?? []) {
      segments.push([...place(ax, ay), ...place(bx, by)]);
    }
  });
  const xs = segments.flatMap(([ax, , bx]) => [ax, bx]);
  const ys = segments.flatMap(([, ay, , by]) => [ay, by]);
  const pad = at.halfWidth;
  const box = [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ] as const;
  return { segments, halfWidth: at.halfWidth, box };
}

function distanceTo(t: Text, x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  if (x < t.box[0] || y < t.box[1] || x > t.box[2] || y > t.box[3]) return best;
  for (const [ax, ay, bx, by] of t.segments) {
    const vx = bx - ax;
    const vy = by - ay;
    const s = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
    best = Math.min(best, Math.hypot(x - ax - s * vx, y - ay - s * vy));
  }
  return best;
}

// The blue square, 76 px, turned 17 degrees about (70, 62).
function inSquare(x: number, y: number, inset = 0): boolean {
  const c = Math.cos((17 * Math.PI) / 180);
  const s = Math.sin((17 * Math.PI) / 180);
  const u = (x - 70) * c + (y - 62) * s;
  const v = -(x - 70) * s + (y - 62) * c;
  return Math.abs(u) <= 38 - inset && Math.abs(v) <= 38 - inset;
}

function inTriangle(x: number, y: number): boolean {
  const side = (ax: number, ay: number, bx: number, by: number): number =>
    (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const d1 = side(150, 22, 196, 100);
  const d2 = side(196, 100, 118, 104);
  const d3 = side(118, 104, 150, 22);
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
}

// "KERF LINE": 26 px caps, 3.2 px strokes (Arial at 40 px is about 3.5 px).
const THIN = text('KERF LINE', { x: 20, y: 196, scale: 1, halfWidth: 1.6 });

// Flat-colour logo, anti-aliased: a yellow band, a red disc, the blue square,
// a green triangle and the black text on near-white paper. The text is 1.5 %
// of the image.
const LOGO = render(W, H, (x, y) => {
  if (distanceTo(THIN, x, y) <= THIN.halfWidth) return [26, 26, 26];
  if (inSquare(x, y)) return BLUE;
  if (inTriangle(x, y)) return [40, 160, 70];
  if ((x - 250) ** 2 + (y - 62) ** 2 <= 42 * 42) return [210, 40, 40];
  if (y >= 134 && y < 160) return [240, 190, 40];
  return PAPER;
});

// Pixel centres where the trace must not hesitate.
function samples(inside: (x: number, y: number) => boolean): Vec2[] {
  const points: Vec2[] = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (inside(x + 0.5, y + 0.5)) points.push({ x: x + 0.5013, y: y + 0.5017 });
    }
  }
  return points;
}

const TEXT_CORE = samples((x, y) => distanceTo(THIN, x, y) <= THIN.halfWidth - 1);
const SQUARE_CORE = samples((x, y) => inSquare(x, y, 3));

function share(path: ColoredPath, points: ReadonlyArray<Vec2>): number {
  return points.filter((p) => covers(path, p)).length / points.length;
}

function layerHolding(paths: ReadonlyArray<ColoredPath>, points: ReadonlyArray<Vec2>): ColoredPath {
  const shares = paths.map((path) => share(path, points));
  return paths[shares.indexOf(Math.max(...shares))] as ColoredPath;
}

describe('Colour layers Auto keeps thin dark text on its own layer (Q5-P2-2)', () => {
  const conditions: ReadonlyArray<readonly [string, (image: RawImageData) => RawImageData]> = [
    ['clean', (image) => image],
    ['JPEG quality 75', (image) => jpegRoundTrip(image, 75)],
    ['JPEG quality 60', (image) => jpegRoundTrip(image, 60)],
    ['a sigma 1 blur', (image) => gaussianBlur(image, 1)],
    ['sigma 12 grain', (image) => withGrain(image, 12)],
  ];
  for (const [name, degrade] of conditions) {
    it(`traces the text on its own layer at the darkest power after ${name}`, () => {
      const paths = trace(degrade(LOGO));
      // Four flat colours and the text: no grey edge ramp, no JPEG overshoot.
      expect(paths).toHaveLength(5);
      const textLayer = layerHolding(paths, TEXT_CORE);
      const blue = layerHolding(paths, SQUARE_CORE);
      expect(share(textLayer, TEXT_CORE)).toBeGreaterThan(0.95);
      expect(textLayer).not.toBe(blue);
      expect(share(textLayer, SQUARE_CORE)).toBe(0);
      const settings = colourLayerSettings(
        paths.map((path) => path.color),
        100,
        { output: 'cut-out' },
      );
      expect(settings.get(textLayer.color)?.power).toBe(100);
      // The square keeps its own darkness-based power (67.5 % clean) rather
      // than taking the text's 100 % with it.
      expect(settings.get(blue.color)?.power).toBeLessThan(90);
    });
  }
});

describe('what the thin-ink rescue must leave alone', () => {
  it('keeps the edge ramp of bold black text part of the text (blur, JPEG 35)', () => {
    const bold = text('KERF', { x: 10, y: 20, scale: 2, halfWidth: 4 });
    const image = render(240, 120, (x, y) => {
      if (distanceTo(bold, x, y) <= bold.halfWidth) return [0, 0, 0];
      if ((x - 210) ** 2 + (y - 90) ** 2 <= 24 * 24) return BLUE;
      return PAPER;
    });
    for (const degraded of [gaussianBlur(image, 1), jpegRoundTrip(image, 35)]) {
      // Black and blue: no grey layer from the text's blurred or ringing edge.
      expect(trace(degraded)).toHaveLength(2);
    }
  });

  it('does not split grain piled up at black off a large black area', () => {
    const image = render(W, H, (x, y) => {
      if (x >= 40 && x < 240 && y >= 30 && y < 180) return [20, 20, 20];
      if ((x - 320) ** 2 + (y - 120) ** 2 <= 50 * 50) return [208, 48, 48];
      return PAPER;
    });
    // Sigma 20 grain clips a twentieth of the black at 0, a pile of near-black
    // pixels that is a shade of the black, not a second black layer.
    expect(trace(withGrain(image, 20))).toHaveLength(2);
  });
});
