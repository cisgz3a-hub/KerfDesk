import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseSvg } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgWorkerDocument } from './parse-svg-worker';
import { INITIAL_PRESENTATION_STATE, presentationStateFor } from './svg-presentation';
import { createSvgStyleCascade } from './svg-stylesheet';

type Fixture = {
  name: string;
  sheet?: string;
  inline?: string;
  attribute?: string;
  parent?: string;
  expected: number;
};
const cases: Fixture[] = [
  {
    name: 'stylesheet rollback removes the whole unlayered scope',
    sheet: '.x{P:0}.x{P:revert-layer}',
    expected: 1,
  },
  {
    name: 'stylesheet rollback preserves the presentation attribute',
    sheet: '.x{P:0;P:revert-layer}',
    attribute: '0.25',
    expected: 0.25,
  },
  {
    name: 'inline rollback reveals stylesheet',
    sheet: '.x{P:.75}',
    inline: 'P:0;P:revert-layer',
    attribute: '0',
    expected: 0.75,
  },
  {
    name: 'inline rollback without stylesheets reveals attribute',
    inline: 'P:0;P:revert-layer',
    attribute: '.25',
    expected: 0.25,
  },
  {
    name: 'inline important rollback also discards normal inline',
    sheet: '.x{P:.75}',
    inline: 'P:0;P:revert-layer!important',
    expected: 0.75,
  },
  {
    name: 'inline important rollback retains important stylesheet',
    sheet: '.x{P:.25!important;P:.75}',
    inline: 'P:revert-layer!important',
    expected: 0.25,
  },
  {
    name: 'stylesheet important rollback discards intervening normal inline',
    sheet: '.x{P:0;P:revert-layer!important}',
    inline: 'P:.75',
    expected: 1,
  },
  {
    name: 'stylesheet important rollback retains attribute',
    sheet: '.x{P:revert-layer!important}',
    inline: 'P:.75',
    attribute: '.25',
    expected: 0.25,
  },
  {
    name: 'inline important value beats stylesheet rollback',
    sheet: '.x{P:revert-layer!important}',
    inline: 'P:0!important',
    expected: 0,
  },
  {
    name: 'successive rollbacks reveal attribute',
    sheet: '.x{P:revert-layer!important}',
    inline: 'P:revert-layer!important',
    attribute: '.25',
    expected: 0.25,
  },
  { name: 'attribute rollback inherits', attribute: 'revert-layer', parent: '.25', expected: 0.25 },
  {
    name: 'revert still rolls back the attribute',
    sheet: '.x{P:revert}',
    attribute: '0',
    expected: 1,
  },
  { name: 'reported calc wins over earlier zero', sheet: '.x{P:0}.x{P:calc(1)}', expected: 1 },
  { name: 'calculated zero removes geometry', sheet: '.x{P:1}.x{P:calc(0)}', expected: 0 },
  {
    name: 'raw attribute math overrides inherited zero',
    parent: '0',
    attribute: 'calc(1)',
    expected: 1,
  },
  {
    name: 'raw attribute important remains invalid',
    parent: '0',
    attribute: 'calc(1) !important',
    expected: 0,
  },
  ...[
    ['calc(25% * 2)', 0.5],
    ['calc(100% - 50%)', 0.5],
    ['calc((.2 + .3) * 2)', 1],
    ['min(.5, 1)', 0.5],
    ['round(nearest, calc(1px / 1px), .5)', 1],
    ['round(down, calc(3px / 4px), .5)', 0.5],
    ['clamp(none, calc(1px / 2px), .75)', 0.5],
    ['clamp(.25, calc(1px / 2px), none)', 0.5],
    ['max(0, -1)', 0],
    ['clamp(0%, 150%, 100%)', 1],
    ['calc(1e-30)', 1e-30],
    ['calc(1/0)', 1],
    ['calc(-1/0)', 0],
    ['calc(0/0)', 0],
    ['calc(infinity * 1%)', 1],
    ['calc(1/**/ - /**/1)', 0],
    ['calc(1/**/+/**/1)', 0.75],
    ['calc(1-1)', 0.75],
    ['calc(1px)', 0.75],
    ['calc(1 - 50%)', 0.75],
    ['min(.75, 25%)', 0.75],
    ['clamp(0, 150%, 1)', 0.75],
    ['calc(1 + )', 0.75],
    ['calc(1) garbage', 0.75],
    ['calc(1) calc(0)', 0.75],
    ['calc(0)calc(1)', 0.75],
    ['calc(1 1)', 0.75],
    ['calc(1px 1px / 1px)', 0.75],
    ['calc(1px / 1px)', 1],
    ['calc(1px * 1px / (1px * 1px))', 1],
    ['calc(0px * 1px / (1px * 1px))', 0],
    ['calc((1px * 1px + 1px * 1px) / (4px * 1px))', 0.5],
    ['calc(2% * 25% / 100%)', 0.005],
    ['calc((1px + 1) * 0)', 0.75],
    ['calc((1px * 1px + 1px) / (1px * 1px))', 0.75],
    ['calc(min(bogus, 1px * 1px) / (1px * 1px))', 0.75],
    ['calc(min(.5px * 1px, 1px * 1px) / (1px * 1px))', 0.75],
    ['calc(max(.5px * 1px, 1px * 1px) / (1px * 1px))', 0.75],
    ['calc(clamp(0px * 1px, .5px * 1px, 1px * 1px) / (1px * 1px))', 0.75],
    ['calc(1foo / 1foo)', 0.75],
    ['calc(1fr / 1fr)', 0.75],
    ['calc(0px / 1px)', 0],
    ['calc(0px / 0px)', 0],
    ['calc(1px / 0px)', 1],
    ['calc(-1px / 1px)', 0],
    ['calc(25% / 50%)', 0.5],
    ['calc((1in + 96px) / (2in))', 1],
    ['min(1, calc(24px / 1in))', 0.25],
    ['calc(1000ms / 2s)', 0.5],
    ['calc(90deg / .5turn)', 0.5],
    ['calc(96dpi / 1dppx)', 1],
    ['calc(1dpcm / 2.54dpi)', 1],
    ['calc((48dpi + .5x) / 2dppx)', 0.5],
    ['calc(1px / 1s)', 0.75],
    ['calc(1px + 1px / 1px)', 0.75],
    ['calc(1px / 2 * 2px)', 0.75],
    ['infinity', 0.75],
  ].map(([value, expected]) => ({
    name: `math ${value}`,
    inline: `P:.75;P:${value}`,
    expected: expected as number,
  })),
  {
    name: 'comments around important do not change math tokens',
    inline: 'P:calc(1/**/+/**/1) !/**/important;P:0',
    expected: 0,
  },
  {
    name: 'valid important math survives later normal declaration',
    inline: 'P:calc(1 - 1) !/**/important;P:1',
    expected: 0,
  },
];

function fixture(test: Fixture): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20">${[
    'fill',
    'stroke',
  ]
    .map((paint) => {
      const property = `${paint}-opacity`;
      const replace = (value = '') => value.replaceAll('P', property).replaceAll('.x', `.${paint}`);
      return `<style>${replace(test.sheet)}</style><g ${property}="${test.parent ?? '1'}"><rect class="${paint}" width="10" height="10" fill="${paint === 'fill' ? 'red' : 'none'}" stroke="${paint === 'stroke' ? 'blue' : 'none'}" ${property}="${test.attribute ?? ''}" style="${replace(test.inline)}"/></g>`;
    })
    .join('')}</svg>`;
}

describe('SVG paint opacity math and cascade scope', () => {
  it.each(cases)('$name: computed values', (test) => {
    const doc = new DOMParser().parseFromString(fixture(test), 'image/svg+xml');
    const cascade = createSvgStyleCascade(doc.documentElement);
    for (const paint of ['fill', 'stroke'] as const) {
      const rect = doc.querySelector(`.${paint}`)!;
      const parent = presentationStateFor(rect.parentElement!, INITIAL_PRESENTATION_STATE, cascade);
      const state = presentationStateFor(rect, parent, cascade);
      expect(state[`${paint}Opacity`]).toBe(test.expected);
    }
  });

  it.each(cases)('$name: both import routes', async (test) => {
    const svgText = fixture(test);
    const identity = { id: 'math', source: 'opacity-math.svg' };
    const browser = parseSvg({ svgText, ...identity });
    const worker = parseSvgWorkerDocument(
      await readSvgDocumentFromBlob(new NodeBlob([svgText]) as Blob),
      identity,
    );
    for (const result of [browser, worker]) {
      expect(result.object?.paths.map((path) => path.color) ?? []).toEqual(
        test.expected > 0 ? ['#ff0000', '#0000ff'] : [],
      );
    }
  });
});
