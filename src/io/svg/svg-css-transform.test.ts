import { describe, expect, it } from 'vitest';
import { parseSvg } from './parse-svg';
import {
  parseCssRotateProperty,
  parseCssScaleProperty,
  parseCssTransformProperty,
  parseCssTranslateProperty,
  resolveCssTransformTerms,
} from './svg-css-transform';
import { cssLength, cssValueText } from './svg-css-values';
import { affineOfMatrix3d } from './svg-matrix3d';
import { SVG_FILL_BOX_MEASURE_LIMIT } from './svg-object-bbox';
import { parseSvgTransformAttribute } from './svg-transform-attribute';
import { parseSvgTransformOrigin } from './svg-transform-origin';
import { MM_ROOT, transformNote } from './svg-css-transform-routes.test-support';

const BOX = { x: 0, y: 0, width: 200, height: 50 };
function affine(parsed: ReturnType<typeof parseCssTransformProperty>) {
  if (typeof parsed === 'string') return parsed;
  const { a, b, c, d, e, f } = affineOfMatrix3d(resolveCssTransformTerms(parsed, BOX));
  const round = (value: number) => Math.round(value * 1e9) / 1e9 + 0;
  return [a, b, c, d, e, f].map(round);
}

describe('the SVG transform attribute', () => {
  it('reads an SVG 1.1 list into one matrix', () => {
    expect(parseSvgTransformAttribute('translate(10 20) scale(2,3)')).toEqual({
      a: 2,
      b: 0,
      c: 0,
      d: 3,
      e: 10,
      f: 20,
    });
    expect(parseSvgTransformAttribute('rotate(90 10 0)')).toMatchObject({ e: 10, f: -10 });
  });

  it('reads a long list, and a long refused one, in linear time', () => {
    const many = 'translate(1) '.repeat(50_000);
    expect(parseSvgTransformAttribute(many)?.e).toBe(50_000);
    expect(parseSvgTransformAttribute('translate(' + '1 '.repeat(200_000))).toBeNull();
    expect(parseSvgTransformAttribute('rotate(' + ','.repeat(200_000))).toBeNull();
  });
});

describe('the CSS transform property', () => {
  it.each([
    ['translate(10px, 50%)', [1, 0, 0, 1, 10, 25]],
    ['translateX(1in)', [1, 0, 0, 1, 96, 0]],
    ['translateY(25.4mm)', [1, 0, 0, 1, 0, 96]],
    ['scale(2, 50%)', [2, 0, 0, 0.5, 0, 0]],
    ['rotate(0.25turn)', [0, 1, -1, 0, 0, 0]],
    ['rotate(-90deg)', [0, -1, 1, 0, 0, 0]],
    ['skewX(45deg)', [1, 0, 1, 1, 0, 0]],
    ['matrix(1, 2, 3, 4, 5, 6)', [1, 2, 3, 4, 5, 6]],
    ['none', [1, 0, 0, 1, 0, 0]],
    ['perspective(none)', [1, 0, 0, 1, 0, 0]],
  ] as const)('reads %s', (text, matrix) => {
    expect(affine(parseCssTransformProperty(text))).toEqual(matrix);
  });

  it.each([
    'translate(10)',
    'rotate(90)',
    'translate(1px 2px)',
    'translateX(1px, 2px)',
    'translateZ(10%)',
    'scale()',
    'skew(1deg, 2deg, 3deg)',
    'perspective(-1px)',
    'matrix(1, 0, 0, 1, 0)',
    'rotate3d(0, 0, 1)',
    'wobble(1px)',
    'translateX(1foo)',
    '',
  ])('refuses %j as a browser does', (text) => {
    expect(parseCssTransformProperty(text)).toBe('invalid');
  });

  it.each([
    'translateX(1em)',
    'translateX(2rem)',
    'translateX(5vw)',
    'translateX(calc(1px))',
    'var(--t)',
  ])('cannot evaluate %j', (text) => {
    expect(parseCssTransformProperty(text)).toBe('unresolved');
  });

  it('reads comments, an important mark and adversarial input in linear time', () => {
    expect(cssValueText('translateX(/* a */20px) ! important')).toBe('translateX( 20px)');
    expect(parseCssTransformProperty('translateX(1px)'.repeat(50_000))).not.toBe('invalid');
    expect(parseCssTransformProperty('a('.repeat(100_000))).toBe('invalid');
    // "/*/*/" is one comment, then a literal "*": CSS's own reading.
    expect(cssValueText('/*'.repeat(100_000))).toMatch(/^[* ]*$/);
  });
});

describe('the individual transform properties', () => {
  it('reads translate, rotate and scale', () => {
    expect(affine(parseCssTranslateProperty('10px 50%'))).toEqual([1, 0, 0, 1, 10, 25]);
    expect(affine(parseCssRotateProperty('z 90deg'))).toEqual([0, 1, -1, 0, 0, 0]);
    expect(affine(parseCssRotateProperty('0 0 -1 90deg'))).toEqual([0, -1, 1, 0, 0, 0]);
    expect(affine(parseCssScaleProperty('2'))).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it.each([
    ['translate', parseCssTranslateProperty, '1px 2px 3px 4px'],
    ['translate', parseCssTranslateProperty, '1px 2px 3%'],
    ['rotate', parseCssRotateProperty, '90'],
    ['rotate', parseCssRotateProperty, 'w 90deg'],
    ['scale', parseCssScaleProperty, '1 2 3 4'],
    ['scale', parseCssScaleProperty, '2px'],
  ] as const)('refuses an invalid %s', (_name, parse, text) => {
    expect(parse(text)).toBe('invalid');
  });
});

describe('transform-origin', () => {
  const px = (value: number) => ({ px: value, percent: 0 });
  const percent = (value: number) => ({ px: 0, percent: value });

  it.each([
    ['center', false, { x: percent(0.5), y: percent(0.5), z: 0 }],
    ['bottom right', false, { x: percent(1), y: percent(1), z: 0 }],
    ['left 2px', false, { x: percent(0), y: px(2), z: 0 }],
    ['2px', false, { x: px(2), y: percent(0.5), z: 0 }],
    ['1in 0 1px', false, { x: px(96), y: px(0), z: 1 }],
    ['5 6', true, { x: px(5), y: px(6), z: 0 }],
  ] as const)('reads %j', (text, attribute, origin) => {
    expect(parseSvgTransformOrigin(text, attribute)).toEqual(origin);
  });

  it.each(['top 2px', '2px left', 'left right', 'top bottom', '1 2', '1px 2px 3%', 'a b c d'])(
    'refuses %j in CSS',
    (text) => {
      expect(parseSvgTransformOrigin(text, false)).toBe('invalid');
    },
  );

  it('reads a bare number as user units only in the attribute', () => {
    expect(cssLength('5', { percent: true })).toBe('invalid');
    expect(cssLength('5', { percent: true, unitless: true })).toEqual(px(5));
  });
});

describe('fill-box measurement budget', () => {
  it(`measures ${SVG_FILL_BOX_MEASURE_LIMIT} fill boxes, then approximates and says so`, () => {
    const turned =
      '<rect x="10" width="10" height="2" style="transform: rotate(90deg); transform-box: fill-box; transform-origin: center"/>';
    const within = parseSvg({
      svgText: MM_ROOT + turned.repeat(SVG_FILL_BOX_MEASURE_LIMIT) + '</svg>',
      id: 'a',
      source: 'a.svg',
    });
    expect(transformNote(within)).toBe('none');
    const past = parseSvg({
      svgText: MM_ROOT + turned.repeat(SVG_FILL_BOX_MEASURE_LIMIT + 1) + '</svg>',
      id: 'b',
      source: 'b.svg',
    });
    expect(past.notes).toContain(
      'SVG presentation: Imported 1 SVG element(s) with a CSS transform KerfDesk could only approximate (such as font- or window-relative units, calc() or var(), or a stroke-box reference box); a browser may place them differently. Check their placement against the design.',
    );
  });
});
