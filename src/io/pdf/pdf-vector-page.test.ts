import { describe, expect, it } from 'vitest';
import { parseSvg } from '../svg';
import { pdfVectorPage } from './pdf-vector-page';

const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  setLineWidth: 2,
  setDash: 6,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  constructPath: 91,
  showText: 44,
  clip: 29,
  paintImageXObject: 85,
  setGState: 9,
};
const viewport = { width: 144, height: 72, transform: [1, 0, 0, -1, 0, 72] };
const line = [0, 10, 10, 1, 30, 10, 2, 35, 10, 40, 20, 40, 30];

describe('PDF paths and whole-page fallback', () => {
  it('preserves physical page size, PDF coordinates, curves and stroke colour', () => {
    const result = pdfVectorPage(
      {
        fnArray: [58, 91],
        argsArray: [['#ff0000'], [20, [Float32Array.from(line)], [10, 10, 40, 30]]],
      },
      OPS,
      viewport,
    );
    expect(result.reason).toBeNull();
    const object = parseSvg({ svgText: result.svg ?? '', id: 'pdf', source: 'page' }).object;
    expect(object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 50.8, maxY: 25.4 });
    expect(object?.paths[0]?.color).toBe('#ff0000');
    expect(result.svg).toContain('C35 10 40 20 40 30');
    expect(
      object?.paths[0]?.curves?.[0]?.segments.some((segment) => segment.kind === 'cubic'),
    ).toBe(true);
  });

  it('closes implicit filled contours and retains even-odd holes', () => {
    const result = pdfVectorPage(
      {
        fnArray: [91],
        argsArray: [[23, [[0, 0, 0, 1, 30, 0, 1, 30, 30, 0, 10, 10, 1, 20, 10, 1, 20, 20]], null]],
      },
      OPS,
      viewport,
    );
    expect(result.svg).toContain('L30 30 Z M10 10');
    expect(result.svg).toContain('fill-rule="evenodd"');
  });

  it('closeStroke closes only the last contour and adds no extra cutting edge to earlier ones', () => {
    const result = pdfVectorPage(
      {
        fnArray: [91],
        argsArray: [
          [21, [[0, 10, 10, 1, 30, 10, 1, 30, 30, 0, 50, 10, 1, 70, 10, 1, 70, 30, 4]], null],
        ],
      },
      OPS,
      viewport,
    );
    expect(result.svg).toContain('L30 30 M50 10');
    expect(result.svg).toContain('L70 30 Z');
    expect(result.svg?.match(/\bZ\b/g)).toHaveLength(1);
  });

  it.each([44, 29, 85, 9, 999])(
    'renders the entire page when operator %i is unsupported',
    (operator) => {
      const result = pdfVectorPage(
        {
          fnArray: [91, operator],
          argsArray: [[20, [line], null], []],
        },
        OPS,
        viewport,
      );
      expect(result.svg).toBeNull();
      expect(result.reason).toBeTruthy();
    },
  );

  it('does not expose clipped, dashed or non-finite paths as editable content', () => {
    for (const argsArray of [
      [[20, [[0, -1, 10, 1, 20, 10]], null]],
      [[20, [[0, NaN, 10]], null]],
    ]) {
      expect(pdfVectorPage({ fnArray: [91], argsArray }, OPS, viewport).svg).toBeNull();
    }
    expect(
      pdfVectorPage(
        {
          fnArray: [6, 91],
          argsArray: [
            [[2, 3], 0],
            [20, [line], null],
          ],
        },
        OPS,
        viewport,
      ).svg,
    ).toBeNull();
  });

  it('composes nested transforms and closes only the requested path', () => {
    const result = pdfVectorPage(
      { fnArray: [10, 12, 91, 11], argsArray: [[], [2, 0, 0, 2, 5, 6], [21, [line], null], []] },
      OPS,
      viewport,
    );
    expect(result.svg).toContain('matrix(2 0 0 -2 5 66)');
    expect(result.svg).toContain('40 30 Z');
  });
});
