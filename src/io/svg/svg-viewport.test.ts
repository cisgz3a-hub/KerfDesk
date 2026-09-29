import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASPECT_RATIO,
  parsePreserveAspectRatio,
  parseViewBox,
  svgViewportAt,
  svgViewportTransform,
  viewBoxMatrix,
} from './svg-viewport';

function element(markup: string, id: string): Element {
  const document = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${markup}</svg>`,
    'image/svg+xml',
  );
  const found = document.getElementById(id);
  if (found === null) throw new Error(`no #${id}`);
  return found;
}

describe('parsePreserveAspectRatio', () => {
  it('reads the alignment and meet or slice', () => {
    expect(parsePreserveAspectRatio('xMinYMax slice')).toEqual({
      align: { x: 0, y: 1 },
      slice: true,
    });
    expect(parsePreserveAspectRatio('defer none')).toEqual({ align: 'none', slice: false });
  });

  it('falls back to xMidYMid meet for a missing or invalid value', () => {
    for (const value of [null, '', 'bogus', 'xMidYMid meet extra', 'xMinYMin stretch']) {
      expect(parsePreserveAspectRatio(value)).toEqual(DEFAULT_ASPECT_RATIO);
    }
  });
});

describe('parseViewBox', () => {
  it('reads four numbers separated by spaces or commas', () => {
    expect(parseViewBox(' 0,5 10 20 ')).toEqual({ x: 0, y: 5, width: 10, height: 20 });
  });

  it('rejects a negative or malformed box and disables rendering for a zero one', () => {
    expect(parseViewBox('0 0 -1 5')).toBeNull();
    expect(parseViewBox('0 0 10')).toBeNull();
    expect(parseViewBox('0 0 0 5')).toBe('empty');
  });
});

describe('viewBoxMatrix', () => {
  const viewBox = { x: 0, y: 0, width: 10, height: 20 };
  const viewport = { x: 0, y: 0, width: 40, height: 40 };

  it('meets, slices or stretches as preserveAspectRatio says', () => {
    expect(viewBoxMatrix(viewBox, viewport, DEFAULT_ASPECT_RATIO)).toEqual({
      a: 2,
      b: 0,
      c: 0,
      d: 2,
      e: 10,
      f: 0,
    });
    expect(viewBoxMatrix(viewBox, viewport, parsePreserveAspectRatio('xMaxYMax slice'))).toEqual({
      a: 4,
      b: 0,
      c: 0,
      d: 4,
      e: 0,
      f: -40,
    });
    expect(viewBoxMatrix(viewBox, viewport, parsePreserveAspectRatio('none'))).toEqual({
      a: 4,
      b: 0,
      c: 0,
      d: 2,
      e: 0,
      f: 0,
    });
  });
});

describe('svgViewportTransform', () => {
  it('places a nested viewport by percentages of its parent', () => {
    const svg = element(
      '<svg id="inner" x="10%" y="10" width="50%" height="50%" viewBox="0 0 10 10"/>',
      'inner',
    );
    expect(svgViewportTransform(svg, { width: 200, height: 100 })).toEqual({
      matrix: { a: 5, b: 0, c: 0, d: 5, e: 45, f: 10 },
      viewport: { width: 10, height: 10 },
    });
  });

  it('only translates content without a viewBox, and renders nothing at zero size', () => {
    const plain = element('<svg id="inner" x="3" y="4" width="20"/>', 'inner');
    expect(svgViewportTransform(plain, { width: 200, height: 100 })).toEqual({
      matrix: { a: 1, b: 0, c: 0, d: 1, e: 3, f: 4 },
      viewport: { width: 20, height: 100 },
    });
    expect(
      svgViewportTransform(plain, { width: 200, height: 100 }, { width: 0, height: null }),
    ).toBeNull();
  });

  it('knows the viewport inside nested <svg> elements', () => {
    const rect = element('<svg width="50" height="40"><g><rect id="shape"/></g></svg>', 'shape');
    expect(svgViewportAt(rect)).toEqual({ width: 50, height: 40 });
  });
});
