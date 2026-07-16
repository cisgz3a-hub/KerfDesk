import { describe, expect, it } from 'vitest';
import { FORGE_SCRIPT_STYLE_KEYS, forgeStrokeFont } from './forge-stroke-font';
import { singleLineTextToPolylines } from './single-line-text';

const FORGE_FONT_KEYS = [
  'forge-soft',
  'forge-soft-cursive',
  'forge-compact',
  'forge-sign',
  'forge-swing',
  'forge-grace',
  'forge-grace-flourish',
  ...FORGE_SCRIPT_STYLE_KEYS,
] as const;

const BASE_INPUT = {
  content: 'IO',
  fontKey: 'hershey-simplex',
  sizeMm: 21,
  alignment: 'left' as const,
  lineHeight: 1.4,
  letterSpacing: 0,
  color: '#000000',
};

describe('singleLineTextToPolylines', () => {
  it('renders character strokes as open one-tool-pass geometry', async () => {
    const rendered = await singleLineTextToPolylines(BASE_INPUT);
    const polylines = rendered.paths[0]?.polylines ?? [];

    expect(polylines.length).toBeGreaterThan(0);
    expect(polylines.every((polyline) => !polyline.closed)).toBe(true);
    expect(rendered.paths[0]?.curves?.every((curve) => !curve.closed)).toBe(true);
    expect(rendered.bounds.maxX).toBeGreaterThan(0);
    expect(rendered.bounds.maxY).toBeGreaterThan(0);
  });

  it('keeps an O as one stroke instead of inner and outer outlines', async () => {
    const rendered = await singleLineTextToPolylines({ ...BASE_INPUT, content: 'O' });

    expect(rendered.paths[0]?.polylines).toHaveLength(1);
  });

  it('reuses tracer curve refinement to round a C instead of drawing coarse chords', async () => {
    const rendered = await singleLineTextToPolylines({ ...BASE_INPUT, content: 'C' });
    const points = rendered.paths[0]?.polylines[0]?.points ?? [];

    expect(points.length).toBeGreaterThan(30);
    expect(maxInteriorTurnDeg(points)).toBeLessThan(15);
  });

  it('keeps straight construction strokes exact while rounding curved strokes', async () => {
    const rendered = await singleLineTextToPolylines({ ...BASE_INPUT, content: 'A' });
    const strokes = rendered.paths[0]?.polylines ?? [];

    expect(strokes).toHaveLength(3);
    expect(strokes.every((stroke) => stroke.points.length === 2)).toBe(true);
  });

  it('keeps the refined glyph shape consistent at every text size', async () => {
    const small = await singleLineTextToPolylines({ ...BASE_INPUT, content: 'C', sizeMm: 7 });
    const large = await singleLineTextToPolylines({ ...BASE_INPUT, content: 'C', sizeMm: 42 });
    const smallPoints = small.paths[0]?.polylines[0]?.points ?? [];
    const largePoints = large.paths[0]?.polylines[0]?.points ?? [];

    expect(largePoints).toHaveLength(smallPoints.length);
    largePoints.forEach((point, index) => {
      const smallPoint = smallPoints[index];
      expect(point.x).toBeCloseTo((smallPoint?.x ?? 0) * 6, 10);
      expect(point.y).toBeCloseTo((smallPoint?.y ?? 0) * 6, 10);
    });
  });

  it('aligns shorter lines against the longest line', async () => {
    const left = await singleLineTextToPolylines({ ...BASE_INPUT, content: 'I\nMMMM' });
    const right = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'I\nMMMM',
      alignment: 'right',
    });

    expect(right.paths[0]?.polylines[0]?.points[0]?.x).toBeGreaterThan(
      left.paths[0]?.polylines[0]?.points[0]?.x ?? 0,
    );
  });

  it.each(['ems-allure', 'ems-delight', 'ems-tech', 'ems-osmotron'])(
    'renders %s as detailed open stroke geometry',
    async (fontKey) => {
      const rendered = await singleLineTextToPolylines({
        ...BASE_INPUT,
        content: 'Beautiful',
        fontKey,
      });
      const path = rendered.paths[0];

      expect(path?.polylines.length).toBeGreaterThan(0);
      expect(path?.polylines.every((polyline) => !polyline.closed)).toBe(true);
      expect(path?.curves?.every((curve) => !curve.closed)).toBe(true);
      expect(path?.polylines.some((polyline) => polyline.points.length > 4)).toBe(true);
    },
  );

  it.each(FORGE_FONT_KEYS)(
    'renders the complete Forge family as open cubic machining geometry: %s',
    async (fontKey) => {
      const rendered = await singleLineTextToPolylines({
        ...BASE_INPUT,
        content: 'Aa–Zz 09 & Café',
        fontKey,
      });
      const path = rendered.paths[0];

      expect(path?.polylines.length).toBeGreaterThan(0);
      expect(path?.polylines.every((polyline) => !polyline.closed)).toBe(true);
      expect(path?.curves?.every((curve) => !curve.closed)).toBe(true);
      expect(
        path?.curves
          ?.flatMap((curve) => curve.segments)
          .some((segment) => segment.kind === 'cubic'),
      ).toBe(true);
    },
  );

  it.each(FORGE_FONT_KEYS)(
    'covers printable ASCII plus the text-dialog accents in %s',
    async (fontKey) => {
      const printableAscii = Array.from({ length: 95 }, (_, index) =>
        String.fromCharCode(32 + index),
      ).join('');
      const characters = `${printableAscii}éèêëáàâäíóúñçü`;
      const font = forgeStrokeFont(fontKey);
      const rendered = await singleLineTextToPolylines({
        ...BASE_INPUT,
        content: characters,
        fontKey,
      });

      expect(Array.from(characters).every((character) => font.glyphs.has(character))).toBe(true);
      expect(rendered.bounds.maxX).toBeGreaterThan(0);
      expect(rendered.paths[0]?.polylines.every((polyline) => !polyline.closed)).toBe(true);
    },
  );

  it('joins adjacent Forge Soft Cursive lowercase bodies without a visible gap', async () => {
    const rendered = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'so',
      fontKey: 'forge-soft-cursive',
    });
    const curves = rendered.paths[0]?.curves ?? [];
    const first = curves[0];
    const second = curves[1];
    const firstEnd = first?.segments.at(-1)?.to;

    expect(firstEnd).toEqual(second?.start);
  });

  it('keeps the approved Compact and Sign width directions distinct', async () => {
    const compact = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'MACHINE 04',
      fontKey: 'forge-compact',
    });
    const soft = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'MACHINE 04',
      fontKey: 'forge-soft',
    });
    const sign = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'MACHINE 04',
      fontKey: 'forge-sign',
    });

    expect(compact.bounds.maxX).toBeLessThan(soft.bounds.maxX);
    expect(sign.bounds.maxX).toBeGreaterThan(soft.bounds.maxX);
  });

  it('keeps Forge Swing lowercase connected and gives its capitals sweeping cubic strokes', async () => {
    const lowercase = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'made',
      fontKey: 'forge-swing',
    });
    const capital = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'MCS',
      fontKey: 'forge-swing',
    });
    const lowercaseCurves = lowercase.paths[0]?.curves ?? [];
    const firstEnd = lowercaseCurves[0]?.segments.at(-1)?.to;

    expect(firstEnd).toEqual(lowercaseCurves[1]?.start);
    expect(
      capital.paths[0]?.curves
        ?.flatMap((curve) => curve.segments)
        .some((segment) => segment.kind === 'cubic'),
    ).toBe(true);
  });

  it.each(['forge-grace', 'forge-grace-flourish'] as const)(
    'keeps the elegant lowercase rhythm connected in %s',
    async (fontKey) => {
      const rendered = await singleLineTextToPolylines({
        ...BASE_INPUT,
        content: 'grace',
        fontKey,
      });
      const curves = rendered.paths[0]?.curves ?? [];
      expectCurveJoinsToMeet(curves);
    },
  );

  it.each(FORGE_SCRIPT_STYLE_KEYS)(
    'keeps every approved cursive direction continuously joined in %s',
    async (fontKey) => {
      const rendered = await singleLineTextToPolylines({
        ...BASE_INPUT,
        content: 'madebyhand',
        fontKey,
      });
      expectCurveJoinsToMeet(rendered.paths[0]?.curves ?? []);
    },
  );

  it('keeps the eight approved cursive directions metrically distinct', async () => {
    const widths = await Promise.all(
      FORGE_SCRIPT_STYLE_KEYS.map(async (fontKey) => {
        const rendered = await singleLineTextToPolylines({
          ...BASE_INPUT,
          content: 'Johann Made by Hand',
          fontKey,
        });
        return Math.round((rendered.bounds.maxX - rendered.bounds.minX) * 1000) / 1000;
      }),
    );

    expect(new Set(widths).size).toBe(FORGE_SCRIPT_STYLE_KEYS.length);
  });

  it('gives Forge Grace Flourish wider ornamental capitals than Forge Grace', async () => {
    const grace = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'M',
      fontKey: 'forge-grace',
    });
    const flourish = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'M',
      fontKey: 'forge-grace-flourish',
    });

    expect(flourish.bounds.maxX - flourish.bounds.minX).toBeGreaterThan(
      grace.bounds.maxX - grace.bounds.minX,
    );
    expect(flourish.paths[0]?.curves?.every((curve) => !curve.closed)).toBe(true);
  });

  it('keeps EMS accented glyphs and substitutes unsupported characters visibly', async () => {
    const accented = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'Caf\u00e9',
      fontKey: 'ems-delight',
    });
    const fallback = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: '\ud83e\udd84',
      fontKey: 'ems-delight',
    });
    const question = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: '?',
      fontKey: 'ems-delight',
    });

    expect(accented.bounds.maxX).toBeGreaterThan(0);
    expect(fallback.paths).toEqual(question.paths);
  });

  it('fair-fits decorative EMS strokes but preserves Osmotron geometry', async () => {
    const allure = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'Beautiful',
      fontKey: 'ems-allure',
    });
    const osmotron = await singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'Beautiful',
      fontKey: 'ems-osmotron',
    });
    const allureSegments = allure.paths[0]?.curves?.flatMap((curve) => curve.segments) ?? [];
    const osmotronSegments = osmotron.paths[0]?.curves?.flatMap((curve) => curve.segments) ?? [];

    expect(allureSegments.some((segment) => segment.kind === 'cubic')).toBe(true);
    expect(osmotronSegments.every((segment) => segment.kind === 'line')).toBe(true);
  });
});

function maxInteriorTurnDeg(points: ReadonlyArray<{ readonly x: number; readonly y: number }>) {
  let maximum = 0;
  for (let index = 1; index + 1 < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (previous === undefined || current === undefined || next === undefined) continue;
    const incoming = { x: current.x - previous.x, y: current.y - previous.y };
    const outgoing = { x: next.x - current.x, y: next.y - current.y };
    const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
    if (denominator === 0) continue;
    const cosine = (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator;
    const turn = (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
    maximum = Math.max(maximum, turn);
  }
  return maximum;
}

function expectCurveJoinsToMeet(
  curves: ReadonlyArray<{
    readonly start: { readonly x: number; readonly y: number };
    readonly segments: ReadonlyArray<{ readonly to: { readonly x: number; readonly y: number } }>;
  }>,
): void {
  for (let index = 0; index + 1 < curves.length; index += 1) {
    const current = curves[index];
    const next = curves[index + 1];
    if (current === undefined || next === undefined) continue;
    const currentEnd = current.segments.at(-1)?.to;
    expect(currentEnd?.x).toBeCloseTo(next.start.x, 10);
    expect(currentEnd?.y).toBeCloseTo(next.start.y, 10);
  }
}
