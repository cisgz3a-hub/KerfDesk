// Rolling audit v2 14-P3-1, re-rated P1 by rolling audit v11 (W5 refuter):
// CSS transforms on artwork were ignored or misread, so artwork burned where
// the file does not put it, with no note. Every expected box is what Chromium
// 156 (Chrome for Testing headless shell, network blocked) reports with
// getBoundingClientRect for the element, in a 100 x 100 px root whose user
// unit is one px; here the root is 100 mm with the same viewBox, so one user
// unit is one millimetre (ADR-574 Amendment 1).
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

// A 10 x 10 square, and a 10 x 2 bar at x 10..20 that shows rotations.
const square = (attributes: string) => `<rect width="10" height="10" ${attributes}/>`;
const bar = (attributes: string) => `<rect x="10" width="10" height="2" ${attributes}/>`;

const REFUTER_CASES: readonly Case[] = [
  ['transform: translateX(20px)', square('style="transform: translateX(20px)"'), [20, 0, 30, 10]],
  ['translate: 20px 0', square('style="translate: 20px 0"'), [20, 0, 30, 10]],
  [
    'a style rule translateY(20px)',
    '<style>.m{transform:translateY(20px)}</style>' + square('class="m"'),
    [0, 20, 10, 30],
  ],
  [
    'rotate(90) about transform-origin="5 5"',
    square('transform="rotate(90)" transform-origin="5 5"'),
    [0, 0, 10, 10],
  ],
  // The attribute is an SVG 1.1 list: a browser ignores a `turn` angle there.
  ['transform="rotate(0.25turn)"', bar('transform="rotate(0.25turn)"'), [10, 0, 20, 2], 'invalid'],
  ['control: translate(20px, 0)', square('style="transform: translate(20px, 0)"'), [20, 0, 30, 10]],
];

const FUNCTION_CASES: readonly Case[] = [
  ['translate3d', square('style="transform: translate3d(20px, 5px, 0)"'), [20, 5, 30, 15]],
  ['translate(-20px,-5px)', square('style="transform: translate(-20px,-5px)"'), [-20, -5, -10, 5]],
  ['translate(0, 20px)', square('style="transform: translate(0, 20px)"'), [0, 20, 10, 30]],
  [
    'translateX(0) translateY(5px)',
    square('style="transform: translateX(0) translateY(5px)"'),
    [0, 5, 10, 15],
  ],
  ['translate(10mm)', square('style="transform: translate(10mm)"'), [37.795, 0, 47.795, 10]],
  ['translateX(15pt)', square('style="transform: translateX(15pt)"'), [20, 0, 30, 10]],
  [
    'translate(1pc, 1cm) translateX(4Q)',
    square('style="transform: translate(1pc, 1cm) translateX(4Q)"'),
    [19.78, 37.795, 29.78, 47.795],
  ],
  ['translateX(20PX)', square('style="transform: translateX(20PX)"'), [20, 0, 30, 10]],
  ['TRANSLATEX(20PX)', square('style="transform: TRANSLATEX(20PX)"'), [20, 0, 30, 10]],
  ['translateX(+.2e2px)', square('style="transform: translateX(+.2e2px)"'), [20, 0, 30, 10]],
  ['translateX(  20px  )', square('style="transform: translateX(  20px  )"'), [20, 0, 30, 10]],
  ['a comment in a value', square('style="transform: translateX(/*c*/20px)"'), [20, 0, 30, 10]],
  ['!important', square('style="transform: translateX(20px) !important"'), [20, 0, 30, 10]],
  [
    'translateZ(50px) translateX(20px)',
    square('style="transform: translateZ(50px) translateX(20px)"'),
    [20, 0, 30, 10],
  ],
  [
    'translateX(50%) of the view box',
    square('style="transform: translateX(50%)"'),
    [50, 0, 60, 10],
  ],
  ['scale(2)', bar('style="transform: scale(2)"'), [20, 0, 40, 4]],
  ['scale(200%)', bar('style="transform: scale(200%)"'), [20, 0, 40, 4]],
  ['scaleX(2)', bar('style="transform: scaleX(2)"'), [20, 0, 40, 2]],
  ['scaleY(2)', bar('style="transform: scaleY(2)"'), [10, 0, 20, 4]],
  ['scale3d(2,3,4)', square('style="transform: scale3d(2,3,4)"'), [0, 0, 20, 30]],
  ['scaleZ(4)', square('style="transform: scaleZ(4)"'), [0, 0, 10, 10]],
  ['rotateZ(90deg)', bar('style="transform: rotateZ(90deg)"'), [-2, 10, 0, 20]],
  ['rotate(1.5707963rad)', bar('style="transform: rotate(1.5707963rad)"'), [-2, 10, 0, 20]],
  ['rotate(100grad)', bar('style="transform: rotate(100grad)"'), [-2, 10, 0, 20]],
  ['rotate(-0.25turn)', bar('style="transform: rotate(-0.25turn)"'), [0, -20, 2, -10]],
  [
    'rotate(0) translateX(20px)',
    bar('style="transform: rotate(0) translateX(20px)"'),
    [30, 0, 40, 2],
  ],
  ['rotate3d(0,0,1,90deg)', bar('style="transform: rotate3d(0,0,1,90deg)"'), [-2, 10, 0, 20]],
  ['rotate3d(1,1,0,60deg)', square('style="transform: rotate3d(1,1,0,60deg)"'), [0, 0, 10, 10]],
  ['rotateX(60deg) flattens', square('style="transform: rotateX(60deg)"'), [0, 0, 10, 5]],
  ['rotateY(60deg) flattens', square('style="transform: rotateY(60deg)"'), [0, 0, 5, 10]],
  [
    'perspective(100px) rotateY(30deg)',
    square('style="transform: perspective(100px) rotateY(30deg)"'),
    [0, 0, 8.66, 10],
  ],
  [
    'perspective(100px) translateX(20px)',
    square('style="transform: perspective(100px) translateX(20px)"'),
    [20, 0, 30, 10],
  ],
  [
    'matrix3d with z and w terms',
    square('style="transform: matrix3d(1,0,0,0.01, 0,1,0,0, 0,0,1,0, 20,5,0,1)"'),
    [20, 5, 30, 15],
  ],
  ['skew(30deg)', square('style="transform: skew(30deg)"'), [0, 0, 15.774, 10]],
  ['skew(30deg, 10deg)', square('style="transform: skew(30deg,10deg)"'), [0, 0, 15.774, 11.763]],
  ['skewX(30deg)', square('style="transform: skewX(30deg)"'), [0, 0, 15.774, 10]],
  ['skewY(45deg)', square('style="transform: skewY(45deg)"'), [0, 0, 10, 20]],
  ['matrix(2,0,0,2,20,0)', square('style="transform: matrix(2,0,0,2,20,0)"'), [20, 0, 40, 20]],
  [
    'translateX(20px)rotate(90deg)',
    square('style="transform: translateX(20px)rotate(90deg)"'),
    [10, 0, 20, 10],
  ],
];

// A browser drops each of these declarations, so the attribute (or nothing) applies.
const INVALID_CSS_CASES: readonly Case[] = [
  [
    'unitless translate(20, 0)',
    square('style="transform: translate(20, 0)"'),
    [0, 0, 10, 10],
    'invalid',
  ],
  ['unitless rotate(90)', bar('style="transform: rotate(90)"'), [10, 0, 20, 2], 'invalid'],
  [
    'translate(10px 5px)',
    square('style="transform: translate(10px 5px)"'),
    [0, 0, 10, 10],
    'invalid',
  ],
  [
    'matrix(1 0 0 1 20 0)',
    square('style="transform: matrix(1 0 0 1 20 0)"'),
    [0, 0, 10, 10],
    'invalid',
  ],
  [
    'a comma between functions',
    square('style="transform: translateX(20px), rotate(90deg)"'),
    [0, 0, 10, 10],
    'invalid',
  ],
  ['trailing junk', square('style="transform: translateX(20px) x"'), [0, 0, 10, 10], 'invalid'],
  [
    'a space before the bracket',
    square('style="transform: translateX (20px)"'),
    [0, 0, 10, 10],
    'invalid',
  ],
  [
    'rotate(90deg, 5px, 5px)',
    square('style="transform: rotate(90deg, 5px, 5px)"'),
    [0, 0, 10, 10],
    'invalid',
  ],
  [
    'an invalid declaration over the attribute',
    square('transform="translate(20 0)" style="transform: bogus(3)"'),
    [20, 0, 30, 10],
    'invalid',
  ],
  [
    'an empty declaration over the attribute',
    square('transform="translate(20 0)" style="transform: "'),
    [20, 0, 30, 10],
    'invalid',
  ],
];

const KEYWORD_CASES: readonly Case[] = [
  [
    'transform: none over the attribute',
    square('transform="translate(20 0)" style="transform: none"'),
    [0, 0, 10, 10],
  ],
  [
    'transform: unset over the attribute',
    square('transform="translate(20 0)" style="transform: unset"'),
    [0, 0, 10, 10],
  ],
  [
    'transform: initial over the attribute',
    square('transform="translate(20 0)" style="transform: initial"'),
    [0, 0, 10, 10],
  ],
  [
    'transform: inherit',
    `<g style="transform: translateX(20px)">${square('style="transform: inherit"')}</g>`,
    [40, 0, 50, 10],
  ],
  [
    'a style rule over the attribute',
    `<style>rect{transform:translateX(5px)}</style>${square('transform="translate(20 0)"')}`,
    [5, 0, 15, 10],
  ],
  [
    'an important rule over an inline style',
    `<style>.m{transform:translateX(20px) !important}</style>${square('class="m" style="transform: translateX(5px)"')}`,
    [20, 0, 30, 10],
  ],
];

const INDIVIDUAL_PROPERTY_CASES: readonly Case[] = [
  ['translate: 20px', bar('style="translate: 20px"'), [30, 0, 40, 2]],
  ['translate: 20px 5px 7px', square('style="translate: 20px 5px 7px"'), [20, 5, 30, 15]],
  ['translate: 50% 10%', square('style="translate: 50% 10%"'), [50, 10, 60, 20]],
  ['translate: none', square('style="translate: none"'), [0, 0, 10, 10]],
  ['translate: 20px, 5px', square('style="translate: 20px, 5px"'), [0, 0, 10, 10], 'invalid'],
  ['rotate: 90deg', bar('style="rotate: 90deg"'), [-2, 10, 0, 20]],
  ['rotate: 0.25turn', bar('style="rotate: 0.25turn"'), [-2, 10, 0, 20]],
  ['rotate: z 90deg', bar('style="rotate: z 90deg"'), [-2, 10, 0, 20]],
  ['rotate: 90deg z', bar('style="rotate: 90deg z"'), [-2, 10, 0, 20]],
  ['rotate: 0 0 1 90deg', bar('style="rotate: 0 0 1 90deg"'), [-2, 10, 0, 20]],
  ['rotate: 0 0 -1 90deg', bar('style="rotate: 0 0 -1 90deg"'), [0, -20, 2, -10]],
  ['rotate: x 60deg', square('style="rotate: x 60deg"'), [0, 0, 10, 5]],
  ['rotate: 0', bar('style="rotate: 0"'), [10, 0, 20, 2]],
  ['rotate: 90', bar('style="rotate: 90"'), [10, 0, 20, 2], 'invalid'],
  ['scale: 2', bar('style="scale: 2"'), [20, 0, 40, 4]],
  ['scale: 2 3', bar('style="scale: 2 3"'), [20, 0, 40, 6]],
  ['scale: 2 3 4', bar('style="scale: 2 3 4"'), [20, 0, 40, 6]],
  ['scale: 200%', bar('style="scale: 200%"'), [20, 0, 40, 4]],
  ['scale: 200% 50%', bar('style="scale: 200% 50%"'), [20, 0, 40, 1]],
  // CSS order: translate, then rotate, then scale, then transform.
  [
    'rotate, then transform',
    bar('style="rotate: 90deg; transform: translateX(20px)"'),
    [-2, 30, 0, 40],
  ],
  ['translate, then rotate', bar('style="translate: 20px; rotate: 90deg"'), [18, 10, 20, 20]],
  ['rotate, then scale', bar('style="scale: 2 1; rotate: 90deg"'), [-2, 20, 0, 40]],
  [
    'rotate, then the attribute',
    bar('transform="translate(20 0)" style="rotate: 90deg"'),
    [-2, 30, 0, 40],
  ],
  [
    'all four about an origin',
    bar(
      'style="translate: 5px 5px; rotate: 90deg; scale: 2; transform: translateX(3px); transform-origin: 15px 1px"',
    ),
    [18, 2, 22, 22],
  ],
  // Individual transform properties are CSS only: as attributes they do nothing.
  ['a translate attribute', square('translate="20 0"'), [0, 0, 10, 10]],
];

const CONTAINER_CASES: readonly Case[] = [
  [
    'a <use> with a CSS transform, before its x',
    '<defs><rect id="r" width="10" height="10"/></defs><use href="#r" x="5" style="transform: translateX(20px)"/>',
    [25, 0, 35, 10],
  ],
  [
    'a <use> rotated about an origin',
    '<defs><rect id="r" x="10" width="10" height="2"/></defs><use href="#r" x="5" style="transform: rotate(90deg); transform-origin: 15px 1px"/>',
    [14, 1, 16, 11],
  ],
  [
    'a nested <svg> transform attribute',
    `<svg x="10" width="50" height="50" transform="translate(20 0)">${square('')}</svg>`,
    [30, 0, 40, 10],
  ],
  [
    'translateX(10%) of a nested viewBox',
    `<svg width="50" height="50" viewBox="0 0 200 200">${square('style="transform: translateX(10%)"')}</svg>`,
    [5, 0, 7.5, 2.5],
  ],
];

describe.each(SVG_IMPORT_ROUTES)('CSS transforms on artwork (%s)', (_route, parse) => {
  const groups = {
    'the refuter repro': REFUTER_CASES,
    'transform functions': FUNCTION_CASES,
    'invalid CSS': INVALID_CSS_CASES,
    'CSS-wide keywords and the cascade': KEYWORD_CASES,
    'translate, rotate and scale': INDIVIDUAL_PROPERTY_CASES,
    'use and nested viewports': CONTAINER_CASES,
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

  it.each([
    ['viewBox="0 0 200 50"', 'transform: translateX(50%)', [50, 37.5, 55, 42.5]],
    ['viewBox="10 10 100 100"', 'transform: translateX(10%)', [10, 0, 20, 10]],
    ['viewBox="0 0 200 200"', 'translate: 10%', [10, 0, 15, 5]],
    ['viewBox="0 0 50 50"', 'transform: translateX(20px)', [40, 0, 60, 20]],
  ] as const)('resolves percentages and px in the root %s', async (viewBox, style, chromium) => {
    const root = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" ${viewBox}>`;
    const rect = viewBox.startsWith('viewBox="10') ? 'x="10" y="10" ' : '';
    const result = await parse(
      `${root}<rect ${rect}width="10" height="10" style="${style}"/></svg>`,
    );
    expect(importedBox(result)).toEqual(chromium);
  });
});
