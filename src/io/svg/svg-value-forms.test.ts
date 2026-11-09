import { describe, expect, it } from 'vitest';
import { readSvgArtworkOrigin, SVG_ARTWORK_ORIGIN_ATTRIBUTE } from './svg-artwork-origin';
import { inheritedSvgFillRule } from './svg-fill-rule';
import { svgOverflow } from './svg-overflow';
import { parseSvgPaint } from './svg-paint';
import { parseSvgTransformAttribute } from './svg-transform-attribute';
import { parseSvgLengthMmOrNull, parseSvgLengthUserUnitsOrNull } from './svg-units';

// The written forms each SVG value reader accepts and refuses.

function svgRoot(attributes: string): Element {
  return new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}/>`,
    'image/svg+xml',
  ).documentElement;
}

describe('SVG lengths', () => {
  it.each([
    ['1', 1],
    [' 1.5 ', 1.5],
    ['5.', 5],
    ['.5', 0.5],
    ['-2e1', -20],
    ['+3E-1px', 0.3],
    ['4 px', 4],
    ['\t2\nin\n', 192],
  ])('reads %j as %f user units', (text, value) => {
    expect(parseSvgLengthUserUnitsOrNull(text)).toBeCloseTo(value, 9);
  });

  it.each(['mm', '1 2', '1mm x', '1..2', '1e', '1 e 2', '1%', '1 mm !'])('refuses %j', (text) => {
    expect(parseSvgLengthUserUnitsOrNull(text)).toBeNull();
    expect(parseSvgLengthMmOrNull(text)).toBeNull();
  });

  it('reads a unit written apart from its number', () => {
    expect(parseSvgLengthMmOrNull(' 25.4  mm ')).toBeCloseTo(25.4, 9);
    expect(parseSvgLengthMmOrNull('96')).toBeCloseTo(25.4, 9);
  });
});

describe('SVG paint references', () => {
  it.each([
    ['url(#a)', 'a', null],
    ['url( #a )', 'a', null],
    ['url("#a") red', 'a', '#ff0000'],
    ["url( '#a' )none", 'a', 'none'],
    ['url(#a)   !important', 'a', null],
  ])('reads %j', (text, id, fallback) => {
    const paint = parseSvgPaint(text);
    expect(paint).toMatchObject({ kind: 'server', id });
    const kept = paint !== null && paint !== 'inherit' && paint.kind === 'server' ? paint : null;
    const color = kept?.fallback?.kind === 'color' ? kept.fallback.color : kept?.fallback?.kind;
    expect(color ?? null).toBe(fallback);
  });

  it('reads an empty reference as no paint server', () => {
    expect(parseSvgPaint('url()')).toEqual({ kind: 'server', id: null, fallback: null });
    expect(parseSvgPaint('url(   )')).toEqual({ kind: 'server', id: null, fallback: null });
  });

  it.each(['url(a b)', 'url("a"b)', 'url(#a'])('does not read %j as a reference', (text) => {
    expect(parseSvgPaint(text)).toBeNull();
  });

  it('reads a colour marked important with spaces around the mark', () => {
    expect(parseSvgPaint('red   ! important')).toEqual({ kind: 'color', color: '#ff0000' });
  });
});

describe('SVG transform lists', () => {
  // A browser reads the attribute strictly (ADR-574 Amendment 1): a function
  // name stands alone, and a list that does not close is ignored whole.
  it('reads functions separated by space or one comma, with space before a bracket', () => {
    expect(parseSvgTransformAttribute('translate(1 2) rotate (90,5,5)')).not.toBeNull();
    expect(parseSvgTransformAttribute('translate(1 2),scale(2)')).not.toBeNull();
  });

  it.each(['xscale(2)', '9scale(2)', 'scale(2) rotate(4', 'rotate(4', 'scale ( calc(1) 2)'])(
    'ignores %j whole',
    (text) => {
      expect(parseSvgTransformAttribute(text)).toBeNull();
    },
  );
});

describe('SVG artwork origin metadata', () => {
  it.each([
    ['v1 5 -3', { x: 5, y: -3 }],
    ['v1 5. .5', { x: 5, y: 0.5 }],
    ['  v1  1e2\t-2.5E-1 ', { x: 100, y: -0.25 }],
  ])('reads %j', (value, origin) => {
    expect(readSvgArtworkOrigin(svgRoot(`${SVG_ARTWORK_ORIGIN_ATTRIBUTE}="${value}"`))).toEqual(
      origin,
    );
  });

  it.each(['v2 1 2', 'v1 1', 'v1 1 2 3', 'v1 1x 2', 'v1 . 2', 'v1 1 2!'])('ignores %j', (value) => {
    expect(readSvgArtworkOrigin(svgRoot(`${SVG_ARTWORK_ORIGIN_ATTRIBUTE}="${value}"`))).toBeNull();
  });
});

describe('SVG keywords marked important', () => {
  it('reads a fill rule and an overflow with spaces before the mark', () => {
    expect(inheritedSvgFillRule('evenodd   !important', 'nonzero')).toBe('evenodd');
    expect(inheritedSvgFillRule('evenodd !importantx', 'nonzero')).toBe('nonzero');
    const group = svgRoot('').ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
    expect(svgOverflow(group, ['hidden   !IMPORTANT'], 'visible')).toBe('hidden');
  });
});
