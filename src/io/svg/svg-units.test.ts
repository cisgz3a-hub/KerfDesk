import { describe, expect, it } from 'vitest';
import { parseSvg } from './parse-svg';
import {
  parseSvgLengthMmOrNull,
  parseSvgLengthUserUnitsOrNull,
  resolveUnitScale,
  svgRootSizeNotes,
} from './svg-units';

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

// CSS Values and Units 3 section 5.2: "1Q = 1/40th of 1cm". Chromium 152
// draws <svg width="200Q"> at 50 mm; the root once read Q as undeclared and
// imported this file at the viewBox size, 100 mm, with no note (J6-P3-2).
describe('resolveUnitScale — quarter-millimetres', () => {
  it.each(['200Q', '200q', ' 200Q '])('sizes a root of %j at 50 mm', (width) => {
    const scale = resolveUnitScale(
      svgRoot(`viewBox="0 0 100 100" width="${width}" height="${width}"`),
    );
    expect(scale.scaleX).toBe(0.5);
    expect(scale.bounds).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 50 });
  });

  it('sizes a root without a viewBox at 50 mm', () => {
    const scale = resolveUnitScale(svgRoot('width="200Q" height="80Q"'));
    expect(scale.bounds).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 20 });
  });

  it('imports the audit file at 50 mm with no size note', () => {
    const result = parseSvg({
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" width="200Q" height="200Q" viewBox="0 0 100 100"><rect width="100" height="100" fill="none" stroke="#000"/></svg>',
      id: 'q',
      source: 'q.svg',
    });
    expect(result.object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 50 });
    expect(result.notes).toEqual([]);
  });

  it.each(['in', 'cm', 'mm', 'q', 'pt', 'pc'])(
    'reads 1%s as the same length on the root and on elements',
    (unit) => {
      const mm = parseSvgLengthMmOrNull(`1${unit}`);
      const userUnits = parseSvgLengthUserUnitsOrNull(`1${unit}`);
      expect(mm).not.toBeNull();
      expect(userUnits).not.toBeNull();
      expect(mm).toBeCloseTo(((userUnits ?? 0) * 25.4) / 96, 12);
    },
  );
});

describe('svgRootSizeNotes', () => {
  it.each(['10em', '3ex', '50vw', '12rem', 'wide'])(
    'notes a root width of %j that it cannot size',
    (width) => {
      const notes = svgRootSizeNotes(svgRoot(`viewBox="0 0 10 10" width="${width}"`));
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(/^SVG size: the root width ".+" is not a length KerfDesk can size/);
    },
  );

  it.each(['', '100%', 'auto', '25mm', '200Q', '96', '96px', '1in'])(
    'stays silent for a root width of %j',
    (width) => {
      expect(svgRootSizeNotes(svgRoot(`viewBox="0 0 10 10" width="${width}"`))).toEqual([]);
    },
  );

  it('reaches the import notes, and both axes are named', () => {
    const result = parseSvg({
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" width="10em" height="5ex" viewBox="0 0 10 10"><rect width="10" height="10" fill="none" stroke="#000"/></svg>',
      id: 'em',
      source: 'em.svg',
    });
    expect(result.notes.filter((note) => note.startsWith('SVG size:'))).toEqual([
      expect.stringContaining('root width "10em"'),
      expect.stringContaining('root height "5ex"'),
    ]);
  });
});
