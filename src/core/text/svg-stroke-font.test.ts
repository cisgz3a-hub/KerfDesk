import { describe, expect, it } from 'vitest';
import { curveSubpathBounds } from '../scene';
import { EMS_STROKE_FONT_DATA } from './ems-stroke-font-data';
import { parseSvgStrokePath, svgStrokeFont } from './svg-stroke-font';

const ALLURE_FIT_TOLERANCE_UNITS = 3;
const ALLURE_MAX_DEVIATION_UNITS = 12;

describe('parseSvgStrokePath', () => {
  it('preserves separate moves, lines, cubics, and exponent coordinates', () => {
    const paths = parseSvgStrokePath('M 1 2 L 3 4 M 5 6 C 7 8 9 10 1e+1 12');

    expect(paths).toEqual([
      {
        start: { x: 1, y: 2 },
        closed: false,
        segments: [{ kind: 'line', to: { x: 3, y: 4 } }],
      },
      {
        start: { x: 5, y: 6 },
        closed: false,
        segments: [
          {
            kind: 'cubic',
            control1: { x: 7, y: 8 },
            control2: { x: 9, y: 10 },
            to: { x: 10, y: 12 },
          },
        ],
      },
    ]);
  });

  it('rejects coordinates before a move command', () => {
    expect(() => parseSvgStrokePath('1 2 L 3 4')).toThrow('must start with a command');
  });

  it('keeps every polished Allure stroke bounded near its source polyline', () => {
    const data = EMS_STROKE_FONT_DATA.find((font) => font.key === 'ems-allure');
    expect(data).toBeDefined();
    if (data === undefined) return;
    const raw = svgStrokeFont(data);
    const polished = svgStrokeFont(data, {
      fitToleranceUnits: ALLURE_FIT_TOLERANCE_UNITS,
    });

    for (const [character, rawGlyph] of raw.glyphs) {
      const polishedPaths = polished.glyphs.get(character)?.paths ?? [];
      expect(polishedPaths).toHaveLength(rawGlyph.paths.length);
      rawGlyph.paths.forEach((rawPath, index) => {
        const polishedPath = polishedPaths[index];
        expect(polishedPath?.closed).toBe(false);
        if (polishedPath === undefined) return;
        const rawBounds = curveSubpathBounds(rawPath);
        const polishedBounds = curveSubpathBounds(polishedPath);
        expect(polishedBounds.minX).toBeGreaterThanOrEqual(
          rawBounds.minX - ALLURE_MAX_DEVIATION_UNITS,
        );
        expect(polishedBounds.minY).toBeGreaterThanOrEqual(
          rawBounds.minY - ALLURE_MAX_DEVIATION_UNITS,
        );
        expect(polishedBounds.maxX).toBeLessThanOrEqual(
          rawBounds.maxX + ALLURE_MAX_DEVIATION_UNITS,
        );
        expect(polishedBounds.maxY).toBeLessThanOrEqual(
          rawBounds.maxY + ALLURE_MAX_DEVIATION_UNITS,
        );
      });
    }
  });
});
