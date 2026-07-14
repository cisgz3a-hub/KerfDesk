import { describe, expect, it } from 'vitest';
import { singleLineTextToPolylines } from './single-line-text';

const FONT_KEYS = ['ems-allure', 'ems-delight', 'ems-tech', 'ems-osmotron'] as const;
const SIZES_MM = [5, 10, 20] as const;
const MAX_SAMPLE_TOOLPATH_POINTS = 1_000;
const CASES = FONT_KEYS.flatMap((fontKey) => SIZES_MM.map((sizeMm) => ({ fontKey, sizeMm })));

describe('EMS stroke font machining sizes', () => {
  it.each(CASES)('$fontKey at $sizeMm mm stays open, finite, and bounded', async (sample) => {
    const result = await singleLineTextToPolylines({
      content: 'CNC Bowl',
      fontKey: sample.fontKey,
      sizeMm: sample.sizeMm,
      alignment: 'left',
      lineHeight: 1.4,
      color: '#000000',
    });
    const path = result.paths[0];
    const curves = path?.curves ?? [];
    const polylines = path?.polylines ?? [];
    const segments = curves.flatMap((curve) => curve.segments);
    const points = polylines.flatMap((polyline) => polyline.points);

    expect(curves).toHaveLength(polylines.length);
    expect(curves.every((curve) => !curve.closed)).toBe(true);
    expect(polylines.every((polyline) => !polyline.closed)).toBe(true);
    expect(points.length).toBeLessThanOrEqual(MAX_SAMPLE_TOOLPATH_POINTS);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
      true,
    );
    if (sample.fontKey === 'ems-osmotron') {
      expect(segments.every((segment) => segment.kind === 'line')).toBe(true);
    } else {
      expect(segments.some((segment) => segment.kind === 'cubic')).toBe(true);
    }
  });
});
