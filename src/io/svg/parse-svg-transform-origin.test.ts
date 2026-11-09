// transform-origin, transform-box and the strict SVG transform attribute, on
// artwork (ADR-574 Amendment 1). Expected boxes are Chromium 156's
// getBoundingClientRect, in a root where one user unit is one millimetre.
// Non-target shapes paint nothing, so only the measured element imports.
import { describe, expect, it } from 'vitest';
import {
  importedBox,
  MM_ROOT,
  SVG_IMPORT_ROUTES,
  transformNote,
  type Box,
  type TransformNote,
} from './svg-css-transform-routes.test-support';

type Case = readonly [label: string, body: string, chromium: Box, note?: TransformNote];

// A 10 x 2 bar at x 10..20, rotated a quarter turn about different origins.
const bar = (attributes: string) => `<rect x="10" width="10" height="2" ${attributes}/>`;
const turned = (style: string) => bar(`style="transform: rotate(90deg); ${style}"`);
const square = (attributes: string) => `<rect width="10" height="10" ${attributes}/>`;

const ORIGIN_CASES: readonly Case[] = [
  ['no origin: 0 0', turned(''), [-2, 10, 0, 20]],
  ['15px 1px', turned('transform-origin: 15px 1px'), [14, -4, 16, 6]],
  ['50% 50% of the view box', turned('transform-origin: 50% 50%'), [98, 10, 100, 20]],
  ['right bottom', turned('transform-origin: right bottom'), [198, 10, 200, 20]],
  ['bottom left, keywords swapped', turned('transform-origin: bottom left'), [98, 110, 100, 120]],
  ['one length centres y', turned('transform-origin: 15px'), [63, 45, 65, 55]],
  ['one keyword top centres x', turned('transform-origin: top'), [48, -40, 50, -30]],
  ['one percentage centres y', turned('transform-origin: 20%'), [68, 40, 70, 50]],
  ['a third value (z)', turned('transform-origin: 15px 1px 30px'), [14, -4, 16, 6]],
  ['millimetres', turned('transform-origin: 1mm 1mm'), [5.559, 10, 7.559, 20]],
  ['unitless in CSS is invalid', turned('transform-origin: 15 1'), [-2, 10, 0, 20], 'invalid'],
  ['initial is 50% 50%', turned('transform-origin: initial'), [98, 10, 100, 20]],
  ['unset is 50% 50%', turned('transform-origin: unset'), [98, 10, 100, 20]],
  [
    'revert returns to the SVG default over the attribute',
    bar('transform-origin="15 1" style="transform: rotate(90deg); transform-origin: revert"'),
    [-2, 10, 0, 20],
  ],
  [
    'inherit',
    `<g style="transform-origin: 15px 1px">${turned('transform-origin: inherit')}</g>`,
    [14, -4, 16, 6],
  ],
  [
    'not inherited by default',
    `<g style="transform-origin: 15px 1px">${turned('')}</g>`,
    [-2, 10, 0, 20],
  ],
  [
    'with the rotate property',
    bar('style="rotate: 90deg; transform-origin: 15px 1px"'),
    [14, -4, 16, 6],
  ],
  ['an attribute without a transform does nothing', bar('transform-origin="15 1"'), [10, 0, 20, 2]],
];

const ATTRIBUTE_ORIGIN_CASES: readonly Case[] = [
  ['15px 1px', bar('transform="rotate(90)" transform-origin="15px 1px"'), [14, -4, 16, 6]],
  ['unitless 15 1', bar('transform="rotate(90)" transform-origin="15 1"'), [14, -4, 16, 6]],
  [
    'center of the view box',
    bar('transform="rotate(90)" transform-origin="center"'),
    [98, 10, 100, 20],
  ],
  ['50% 0', bar('transform="rotate(90)" transform-origin="50% 0"'), [48, -40, 50, -30]],
  [
    'on a group',
    `<g transform="rotate(90)" transform-origin="15 1">${bar('')}</g>`,
    [14, -4, 16, 6],
  ],
  [
    'with a CSS transform',
    bar('style="transform: rotate(90deg)" transform-origin="15 1"'),
    [14, -4, 16, 6],
  ],
  [
    'around a rotate(a cx cy)',
    bar('transform="rotate(90 15 1)" transform-origin="5 5"'),
    [24, -4, 26, 6],
  ],
  [
    'junk is invalid',
    bar('transform="rotate(90)" transform-origin="15 1 x"'),
    [-2, 10, 0, 20],
    'invalid',
  ],
  [
    'a comma is invalid',
    bar('transform="rotate(90)" transform-origin="15,1"'),
    [-2, 10, 0, 20],
    'invalid',
  ],
  // transform-box is CSS only.
  [
    'a transform-box attribute does nothing',
    bar('transform="rotate(90)" transform-box="fill-box" transform-origin="center"'),
    [98, 10, 100, 20],
  ],
];

const BOX_CASES: readonly Case[] = [
  ['fill-box center', turned('transform-box: fill-box; transform-origin: center'), [14, -4, 16, 6]],
  ['fill-box 0 0', turned('transform-box: fill-box; transform-origin: 0 0'), [8, 0, 10, 10]],
  [
    'content-box is fill-box',
    turned('transform-box: content-box; transform-origin: 50% 50%'),
    [14, -4, 16, 6],
  ],
  [
    'translateX(50%) of the fill box',
    square('style="transform: translateX(50%); transform-box: fill-box"'),
    [5, 0, 15, 10],
  ],
  [
    'translate: 50% 50% of the fill box',
    bar('style="translate: 50% 50%; transform-box: fill-box"'),
    [15, 1, 25, 3],
  ],
  [
    'the fill box of a group',
    `<g style="transform: rotate(90deg); transform-box: fill-box; transform-origin: center">${bar('fill="none"')}<rect x="10" y="10" width="10" height="2"/></g>`,
    [9, 1, 11, 11],
  ],
  [
    'the fill box of a <use>, before its x',
    '<defs><rect id="r" x="10" width="10" height="2"/></defs><use href="#r" x="5" style="transform: rotate(90deg); transform-box: fill-box; transform-origin: center"/>',
    [14, 1, 16, 11],
  ],
  [
    'transform-box: inherit',
    `<g style="transform-box: fill-box">${turned('transform-box: inherit; transform-origin: center')}</g>`,
    [14, -4, 16, 6],
  ],
];

// The SVG 1.1 grammar a browser holds the attribute to; anything else voids it.
const ATTRIBUTE_CASES: readonly Case[] = [
  ['translate(20-.5)', square('transform="translate(20-.5)"'), [20, -0.5, 30, 9.5]],
  ['matrix(1 0 0 1-5-3)', square('transform="matrix(1 0 0 1-5-3)"'), [-5, -3, 5, 7]],
  ['translate(.5.5)', square('transform="translate(.5.5)"'), [0.5, 0.5, 10.5, 10.5]],
  ['translate(20 0),scale(2)', square('transform="translate(20 0),scale(2)"'), [20, 0, 40, 20]],
  ['translate(20,0)scale(2)', square('transform="translate(20,0)scale(2)"'), [20, 0, 40, 20]],
  ['translate (20 0)', square('transform="translate (20 0)"'), [20, 0, 30, 10]],
  ['white space around', square('transform="  translate(20)  "'), [20, 0, 30, 10]],
  ['tabs and line feeds', square('transform="translate(&#9;20&#10;0)"'), [20, 0, 30, 10]],
  ['translate(1E1,-1e0)', square('transform="translate(1E1,-1e0)"'), [10, -1, 20, 9]],
  ['rotate(0)translate(5)', square('transform="rotate(0)translate(5)"'), [5, 0, 15, 10]],
  ['skewX(30)', square('transform="skewX(30)"'), [0, 0, 15.774, 10]],
  ['scale(2)', bar('transform="scale(2)"'), [20, 0, 40, 4]],
  ['none', square('transform="none"'), [0, 0, 10, 10]],
  ['empty', square('transform=""'), [0, 0, 10, 10]],
  ['translateX(20px)', square('transform="translateX(20px)"'), [0, 0, 10, 10], 'invalid'],
  ['translate(20px,5px)', square('transform="translate(20px,5px)"'), [0, 0, 10, 10], 'invalid'],
  ['translate(1in)', square('transform="translate(1in)"'), [0, 0, 10, 10], 'invalid'],
  ['translate(50%)', square('transform="translate(50%)"'), [0, 0, 10, 10], 'invalid'],
  ['rotate(90deg)', bar('transform="rotate(90deg)"'), [10, 0, 20, 2], 'invalid'],
  ['scaleX(2)', bar('transform="scaleX(2)"'), [10, 0, 20, 2], 'invalid'],
  ['skew(30deg)', square('transform="skew(30deg)"'), [0, 0, 10, 10], 'invalid'],
  ['skewx(30), lower case', square('transform="skewx(30)"'), [0, 0, 10, 10], 'invalid'],
  ['TRANSLATE(20 0)', square('transform="TRANSLATE(20 0)"'), [0, 0, 10, 10], 'invalid'],
  [
    'an unknown function voids the list',
    square('transform="translate(20 0) bogus(3)"'),
    [0, 0, 10, 10],
    'invalid',
  ],
  ['an empty function', square('transform="translate(20 0) rotate()"'), [0, 0, 10, 10], 'invalid'],
  ['a trailing comma', square('transform="translate(20 0),"'), [0, 0, 10, 10], 'invalid'],
  ['an unclosed list', square('transform="translate(20 0"'), [0, 0, 10, 10], 'invalid'],
  ['rotate with 2 arguments', square('transform="rotate(90 5)"'), [0, 0, 10, 10], 'invalid'],
  [
    'translate with 3 arguments',
    square('transform="translate(20 0 5)"'),
    [0, 0, 10, 10],
    'invalid',
  ],
  ['matrix with 5 arguments', square('transform="matrix(1 0 0 1 20)"'), [0, 0, 10, 10], 'invalid'],
  ['a double comma', square('transform="translate(20,,0)"'), [0, 0, 10, 10], 'invalid'],
  ['a leading comma', square('transform="translate(,20 0)"'), [0, 0, 10, 10], 'invalid'],
  ['junk after the list', square('transform="translate(20) x"'), [0, 0, 10, 10], 'invalid'],
  ['NaN', square('transform="translate(NaN)"'), [0, 0, 10, 10], 'invalid'],
];

describe.each(SVG_IMPORT_ROUTES)(
  'transform origins, boxes and attributes (%s)',
  (_route, parse) => {
    const groups = {
      'transform-origin': ORIGIN_CASES,
      'the transform-origin attribute': ATTRIBUTE_ORIGIN_CASES,
      'transform-box': BOX_CASES,
      'the transform attribute': ATTRIBUTE_CASES,
    };
    for (const [group, cases] of Object.entries(groups)) {
      it.each(cases)(
        `${group}: %s lands where Chromium draws it`,
        async (_label, body, chromium, note = 'none') => {
          const result = await parse(MM_ROOT + body + '</svg>');
          expect(importedBox(result)).toEqual(chromium);
          expect(transformNote(result)).toBe(note);
        },
      );
    }
  },
);

// Valid CSS the importer cannot evaluate: the element imports without that
// value (or with the nearest box) and the import says so, never silently.
describe.each(SVG_IMPORT_ROUTES)('transforms the importer approximates (%s)', (_route, parse) => {
  it.each([
    // Chromium: 16 px (its default font size); a font size is not modelled.
    ['translateX(1em)', square('style="transform: translateX(1em)"'), [0, 0, 10, 10]],
    ['translateX(10vw)', square('style="transform: translateX(10vw)"'), [0, 0, 10, 10]],
    // Chromium: x 20..30 and 55..65.
    ['calc()', square('style="transform: translateX(calc(10px + 10px))"'), [0, 0, 10, 10]],
    ['calc() with %', square('style="transform: translateX(calc(50% + 5px))"'), [0, 0, 10, 10]],
    ['var()', square('style="--d: 20px; transform: translateX(var(--d))"'), [0, 0, 10, 10]],
    ['translate: calc()', square('style="translate: calc(10px + 10px)"'), [0, 0, 10, 10]],
    // The rotation still applies, about the default origin; Chromium: x 14..16.
    [
      'a transform-origin in em',
      bar('transform="rotate(90)" transform-origin="1em 0"'),
      [-2, 10, 0, 20],
    ],
    // Chromium uses the stroke box, x 4..6; the fill box is the nearest the importer measures.
    [
      'stroke-box',
      bar(
        'stroke="black" stroke-width="4" style="transform: rotate(90deg); transform-box: stroke-box; transform-origin: 0 0"',
      ),
      [8, 0, 10, 10],
    ],
    // Chromium measures this fill box inside the viewport, at x 15..16.
    [
      'the fill box of a nested <svg>',
      '<svg x="5" width="50" height="50" viewBox="0 0 100 100" style="transform: rotate(90deg); transform-box: fill-box; transform-origin: center"><rect x="10" width="10" height="2"/></svg>',
      [99, 10, 100, 15],
    ],
  ] as const)('%s imports and is reported', async (_label, body, expected) => {
    const result = await parse(MM_ROOT + body + '</svg>');
    expect(importedBox(result)).toEqual(expected);
    expect(transformNote(result)).toBe('unresolved');
  });

  it('reports a huge translation as invalid rather than moving the artwork kilometres', async () => {
    const result = await parse(
      MM_ROOT + square('style="transform: translateX(1e400px)"') + '</svg>',
    );
    expect(importedBox(result)).toEqual([0, 0, 10, 10]);
    expect(transformNote(result)).toBe('invalid');
  });

  it('counts every imported element under a group whose transform was ignored', async () => {
    const result = await parse(
      `${MM_ROOT}<g transform="translate(20px)">${square('')}${bar('')}</g></svg>`,
    );
    expect(result.notes).toContain(
      'SVG presentation: Imported 2 SVG element(s) without a transform value that a browser also ignores as invalid, such as a transform attribute with units or turn angles (only the CSS transform property accepts those). Check their placement against the design.',
    );
  });
});
