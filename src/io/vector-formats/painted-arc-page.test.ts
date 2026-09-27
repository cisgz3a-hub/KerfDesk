import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../../core/scene';
import { writePdfDocument } from './pdf-writer';
import { writeEpsDocument } from './eps-writer';
import { PT_PER_MM, VECTOR_STROKE_WIDTH_MM, type VectorPaint } from './vector-artwork';

function semicircle(radius: number): CurveSubpath {
  const point = (degrees: number): Vec2 => ({
    x: radius * Math.cos((degrees * Math.PI) / 180),
    y: radius * Math.sin((degrees * Math.PI) / 180),
  });
  return {
    start: point(20),
    closed: true,
    segments: [
      {
        kind: 'elliptical-arc',
        radiusX: radius,
        radiusY: radius,
        rotationDeg: 0,
        largeArc: false,
        sweep: true,
        to: point(200),
      },
    ],
  };
}

// Read actual file operands and sample their cubic polynomial independently
// of the production curve-bound/arc helpers. A rotated arc has extrema
// between its endpoints; the quarter-turn cubic can overshoot the true arc.
function sampleCommands(text: string): Vec2[] {
  const tokens = text.match(/-?\d+(?:\.\d+)?|[mlch]/g) ?? [];
  const operands: number[] = [];
  const points: Vec2[] = [];
  let from = { x: 0, y: 0 };
  const value = (i: number): number => {
    const number = operands[i];
    if (number === undefined) throw new Error('Missing path operand');
    return number;
  };
  for (const token of tokens) {
    if (!/^[mlch]$/.test(token)) {
      operands.push(Number(token));
      continue;
    }
    if (token === 'm' || token === 'l') {
      from = { x: value(0), y: value(1) };
      points.push(from);
    } else if (token === 'c') {
      for (let step = 0; step <= 10_000; step += 1) {
        const t = step / 10_000;
        const u = 1 - t;
        points.push({
          x:
            u ** 3 * from.x +
            3 * u ** 2 * t * value(0) +
            3 * u * t ** 2 * value(2) +
            t ** 3 * value(4),
          y:
            u ** 3 * from.y +
            3 * u ** 2 * t * value(1) +
            3 * u * t ** 2 * value(3) +
            t ** 3 * value(5),
        });
      }
      from = { x: value(4), y: value(5) };
    }
    operands.length = 0;
  }
  return points;
}

function extent(points: Vec2[]) {
  return points.reduce(
    (box, p) => ({
      minX: Math.min(box.minX, p.x),
      minY: Math.min(box.minY, p.y),
      maxX: Math.max(box.maxX, p.x),
      maxY: Math.max(box.maxY, p.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

describe('PDF/EPS page contains the curves actually written', () => {
  it.each([
    ['fill', 100],
    ['fill', 500],
    ['stroke', 100],
    ['stroke', 500],
  ] as const)(
    '%s semicircle of radius%s keeps its quantized cubic ink inside both page boxes',
    (paint: VectorPaint, radius) => {
      const items = [
        { color: '#000000', paint, fillRule: 'evenodd' as const, curves: [semicircle(radius)] },
      ];
      const pdf = writePdfDocument(items);
      const eps = writeEpsDocument(items);
      const body = pdf.text
        .split('\n')
        .filter((line) => /^[-\d. ]+ [mlc]$/.test(line))
        .join('\n');
      const cm = /\n[\d.]+ 0 0 [\d.]+ ([\d.]+) ([\d.]+) cm\n/.exec(pdf.text);
      const pdfOffset = { x: Number(cm?.[1]), y: Number(cm?.[2]) };
      const translate = /\n([\d.]+) ([\d.]+) translate\n/.exec(eps.text);
      const epsOffset = { x: Number(translate?.[1] ?? 0), y: Number(translate?.[2] ?? 0) };
      const epsBody =
        /setrgbcolor newpath\n([\s\S]*?)\n(?:eofill|fill|stroke)\n/.exec(eps.text)?.[1] ?? '';
      const boxes = [
        {
          samples: sampleCommands(body),
          offset: pdfOffset,
          width: pdf.widthPt,
          height: pdf.heightPt,
        },
        {
          samples: sampleCommands(epsBody),
          offset: epsOffset,
          width: eps.widthPt,
          height: eps.heightPt,
        },
      ];
      for (const file of boxes) {
        expect(file.samples.length).toBeGreaterThan(20_000);
        const bounds = extent(
          file.samples.map((p) => ({
            x: p.x * PT_PER_MM + file.offset.x,
            y: p.y * PT_PER_MM + file.offset.y,
          })),
        );
        const pad = paint === 'stroke' ? (VECTOR_STROKE_WIDTH_MM / 2) * PT_PER_MM : 0;
        expect(bounds.minX - pad).toBeGreaterThanOrEqual(-1e-8);
        expect(bounds.minY - pad).toBeGreaterThanOrEqual(-1e-8);
        expect(bounds.maxX + pad).toBeLessThanOrEqual(file.width + 1e-8);
        expect(bounds.maxY + pad).toBeLessThanOrEqual(file.height + 1e-8);
        // Tight to the written ink, rather than padding a control-point hull.
        expect(file.width - (bounds.maxX - bounds.minX + 2 * pad)).toBeLessThan(0.004);
        expect(file.height - (bounds.maxY - bounds.minY + 2 * pad)).toBeLessThan(0.004);
      }
    },
  );
});
