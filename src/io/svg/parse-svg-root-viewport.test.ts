import { describe, expect, it } from 'vitest';
import { parseSvg } from './parse-svg';
import { parseSvgInWorker } from './parse-svg-worker';

for (const [name, parse] of [
  ['fallback', parseSvg],
  ['worker', parseSvgInWorker],
] as const) {
  describe(`root SVG viewport mapping (${name})`, () => {
    function imported(attributes: string) {
      const result = parse({
        id: 'root',
        source: 'root.svg',
        svgText: `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><path fill="none" stroke="#000" d="M10 20 L110 120"/></svg>`,
      });
      return {
        bounds: result.object?.bounds,
        points: result.object?.paths[0]?.polylines[0]?.points,
      };
    }

    it('preserves the default aspect ratio and centers a nonzero viewBox in physical dimensions', () => {
      expect(imported('width="200mm" height="100mm" viewBox="10 20 100 100"')).toEqual({
        bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
        points: [
          { x: 50, y: 0 },
          { x: 150, y: 100 },
        ],
      });
    });
    it('keeps explicit none stretching and subtracts the viewBox origin', () => {
      expect(
        imported('width="200mm" height="100mm" viewBox="10 20 100 100" preserveAspectRatio="none"'),
      ).toEqual({
        bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 100 },
        ],
      });
    });
    it('honours max alignment instead of centering the unused space', () => {
      expect(
        imported(
          'width="200mm" height="100mm" viewBox="10 20 100 100" preserveAspectRatio="xMaxYMin meet"',
        ).points,
      ).toEqual([
        { x: 100, y: 0 },
        { x: 200, y: 100 },
      ]);
    });
    it('uses the larger scale for slice with explicit visible overflow', () => {
      expect(
        imported(
          'width="200mm" height="100mm" viewBox="10 20 100 100" preserveAspectRatio="xMidYMid slice" overflow="visible"',
        ).points,
      ).toEqual([
        { x: 0, y: -50 },
        { x: 200, y: 150 },
      ]);
    });
    it('preserves the documented millimetre coordinate convention without physical dimensions', () => {
      expect(imported('viewBox="10 20 100 100"')).toEqual({
        bounds: { minX: 10, minY: 20, maxX: 110, maxY: 120 },
        points: [
          { x: 10, y: 20 },
          { x: 110, y: 120 },
        ],
      });
    });
    it('infers the missing physical axis from the viewBox aspect ratio', () => {
      expect(imported('width="200mm" viewBox="10 20 100 100"')).toEqual({
        bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 200 },
        ],
      });
    });
    it('does not render a zero-sized root viewBox', () => {
      expect(imported('width="200mm" height="100mm" viewBox="0 0 0 100"').points).toBeUndefined();
    });
  });
}
