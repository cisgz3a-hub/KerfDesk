import { describe, expect, it } from 'vitest';
import { resolveUnitScale } from './svg-units';

function svgRoot(attributes: string): Element {
  return new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}/>`,
    'image/svg+xml',
  ).documentElement;
}

describe('resolveUnitScale — viewBox', () => {
  // SVG 2 viewBox is four numbers separated by whitespace and/or a comma;
  // whitespace around the list is insignificant. Dropping a padded viewBox
  // would fall back to the 96 DPI px rule and import 3.78x too small.
  it.each(['0 0 100 100', ' 0 0 100 100', '0 0 100 100 ', '\n0,0,100,100\n', '\t0 0 100 100\t'])(
    'keeps the viewBox %j and maps it onto the physical size',
    (viewBox) => {
      const scale = resolveUnitScale(svgRoot(`viewBox="${viewBox}" width="200mm" height="200mm"`));
      expect(scale.scaleX).toBe(2);
      expect(scale.scaleY).toBe(2);
      expect(scale.bounds).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 200 });
    },
  );

  it('still ignores a viewBox that does not hold exactly four numbers', () => {
    const scale = resolveUnitScale(svgRoot('viewBox="0 0 100" width="96px" height="96px"'));
    expect(scale.scaleX).toBeCloseTo(25.4 / 96, 12);
    expect(scale.bounds.maxX).toBeCloseTo(25.4, 12);
  });
});
