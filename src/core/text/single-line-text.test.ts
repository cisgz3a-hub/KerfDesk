import { describe, expect, it } from 'vitest';
import { textToPolylines } from './text-to-polylines';

const FONT_KEYS = [
  'relief-single-line',
  'ems-nixish',
  'ems-decorous-script',
  'ems-casual-hand',
] as const;

describe('OFL CNC single-line text rendering', () => {
  it.each(FONT_KEYS)('%s stays open and finite at machining sizes', async (fontKey) => {
    const result = await render(fontKey, 'CNC Workshop 2026', 10);
    const path = result.paths[0];
    const curves = path?.curves ?? [];
    const polylines = path?.polylines ?? [];
    const points = polylines.flatMap((polyline) => polyline.points);

    expect(curves.length).toBeGreaterThan(0);
    expect(curves).toHaveLength(polylines.length);
    expect(curves.every((curve) => !curve.closed)).toBe(true);
    expect(polylines.every((polyline) => !polyline.closed)).toBe(true);
    expect(polylines.some((polyline) => polyline.points.length > 4)).toBe(true);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
      true,
    );
    expect(result.bounds).toMatchObject({ minX: 0, minY: 0 });
    expect(result.bounds.maxX).toBeGreaterThan(0);
    expect(result.bounds.maxY).toBeGreaterThan(0);
  });

  it('preserves native Relief curves instead of reducing them to coarse chords', async () => {
    const rendered = await render('relief-single-line', 'CNC', 10);
    const segments = rendered.paths[0]?.curves?.flatMap((curve) => curve.segments) ?? [];

    expect(segments.some((segment) => segment.kind === 'cubic')).toBe(true);
  });

  it.each(FONT_KEYS)(
    '%s uses the visible fallback glyph for unsupported Unicode',
    async (fontKey) => {
      const unsupported = await render(fontKey, '\u{1F642}', 10);
      const fallback = await render(fontKey, '?', 10);

      expect(unsupported).toEqual(fallback);
    },
  );

  it.each(FONT_KEYS)('%s preserves its accented Latin glyphs', async (fontKey) => {
    const accent = await render(fontKey, '\u00e9', 10);
    const fallback = await render(fontKey, '?', 10);

    expect(accent.paths[0]?.polylines).not.toEqual(fallback.paths[0]?.polylines);
  });

  it('applies letter spacing and multiline alignment through the shared text controls', async () => {
    const natural = await textToPolylines({
      geometry: 'single-line',
      fontKey: 'relief-single-line',
      content: 'AA\nA',
      sizeMm: 10,
      alignment: 'right',
      lineHeight: 1.5,
      letterSpacing: 0,
      color: '#123456',
    });
    const spaced = await textToPolylines({
      geometry: 'single-line',
      fontKey: 'relief-single-line',
      content: 'AA\nA',
      sizeMm: 10,
      alignment: 'right',
      lineHeight: 1.5,
      letterSpacing: 0.2,
      color: '#123456',
    });

    expect(spaced.bounds.maxX).toBeGreaterThan(natural.bounds.maxX);
    expect(spaced.bounds.maxY).toBeGreaterThan(10);
    expect(spaced.paths[0]?.color).toBe('#123456');
  });

  it('rejects unknown CNC font keys instead of silently choosing another face', async () => {
    await expect(
      textToPolylines({
        geometry: 'single-line',
        fontKey: 'unknown-single-line',
        content: 'CNC',
        sizeMm: 10,
        alignment: 'left',
        lineHeight: 1.2,
        color: '#000000',
      }),
    ).rejects.toThrow('Unsupported CNC single-line font');
  });
});

function render(fontKey: (typeof FONT_KEYS)[number], content: string, sizeMm: number) {
  return textToPolylines({
    geometry: 'single-line',
    fontKey,
    content,
    sizeMm,
    alignment: 'left',
    lineHeight: 1.2,
    color: '#000000',
  });
}
