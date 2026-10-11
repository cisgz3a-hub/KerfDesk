import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgWorkerDocument } from './parse-svg-worker';
import { INITIAL_PRESENTATION_STATE, presentationStateFor } from './svg-presentation';
import { createSvgStyleCascade } from './svg-stylesheet';

const identity = { id: 'opacity', source: 'paint-opacity.svg' };
const svg = (content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20">${content}</svg>`;
type Parser = (svgText: string) => ParseSvgResult | Promise<ParseSvgResult>;
const parsers: readonly (readonly [string, Parser])[] = [
  ['browser fallback', (svgText) => parseSvg({ svgText, ...identity })],
  [
    'worker stream',
    async (svgText) =>
      parseSvgWorkerDocument(
        await readSvgDocumentFromBlob(new NodeBlob([svgText], { type: 'image/svg+xml' }) as Blob),
        identity,
      ),
  ],
];
const colors = (result: ParseSvgResult) => result.object?.paths.map((path) => path.color) ?? [];

type CascadeCase = {
  name: string;
  attribute?: string;
  style?: string;
  sheet?: string;
  parent?: string;
  visible: boolean;
};
const cascadeCases: readonly CascadeCase[] = [
  ...[
    String.raw`!\69mportant`,
    String.raw`!\000069mportant`,
    String.raw`!\69 mportant`,
    String.raw`!impor\74 ant`,
    String.raw`!/**/\69mportant/**/`,
  ].map((suffix) => ({
    name: `escaped importance preserves priority: ${suffix}`,
    style: `OPACITY:0 ${suffix};OPACITY:1`,
    visible: false,
  })),
  {
    name: 'escaped important stylesheet overrides normal inline',
    sheet: String.raw`.SUBJECT{OPACITY:0 !\69mportant}`,
    style: 'OPACITY:1',
    visible: false,
  },
  {
    name: 'escaped important remains invalid in a raw presentation attribute',
    parent: '0',
    attribute: String.raw`1 !\69mportant`,
    visible: false,
  },
  ...[String.raw`!im/**/portant`, String.raw`!\69mportantX`, "!'important'"].map((suffix) => ({
    name: `invalid importance cannot replace lower zero: ${suffix}`,
    style: `OPACITY:0;OPACITY:1 ${suffix}`,
    visible: false,
  })),
  {
    name: 'comments around the opacity property name remain valid',
    style: '/*x*/OPACITY/*x*/:0',
    visible: false,
  },
  {
    name: 'invalid inline preserves a valid class rule',
    attribute: '0',
    style: 'OPACITY:bogus',
    sheet: '.SUBJECT{OPACITY:1}',
    visible: true,
  },
  {
    name: 'invalid important rule preserves a valid lower rule',
    sheet: '.SUBJECT{OPACITY:0}.SUBJECT{OPACITY:bogus !important}',
    visible: false,
  },
  {
    name: 'invalid duplicate inline preserves an earlier value',
    style: 'OPACITY:0;OPACITY:bogus',
    visible: false,
  },
  {
    name: 'important inline survives later normal inline',
    style: 'OPACITY:0 !important;OPACITY:1',
    visible: false,
  },
  {
    name: 'later valid important inline wins',
    style: 'OPACITY:0 !important;OPACITY:1 !important',
    visible: true,
  },
  {
    name: 'important in a presentation attribute is invalid',
    parent: '0',
    attribute: '1 !important',
    visible: false,
  },
  {
    name: 'invalid presentation attribute inherits',
    parent: '0',
    attribute: 'garbage',
    visible: false,
  },
  {
    name: 'revert rolls back the author attribute',
    attribute: '0',
    style: 'OPACITY:revert',
    visible: true,
  },
  {
    name: 'revert inherits the parent opacity',
    parent: '0',
    attribute: '1',
    style: 'OPACITY:revert',
    visible: false,
  },
  {
    name: 'important stylesheet revert rolls back inline and attribute',
    attribute: '0',
    style: 'OPACITY:0',
    sheet: '.SUBJECT{OPACITY:revert !important}',
    visible: true,
  },
  { name: 'trailing attribute comment preserves zero', attribute: '0/**/', visible: false },
  { name: 'leading attribute comment preserves zero', attribute: '/*x*/0', visible: false },
  {
    name: 'inline comment containing semicolon preserves zero',
    style: 'OPACITY:0/*;OPACITY:1*/',
    visible: false,
  },
  {
    name: 'comment around important tokens preserves priority',
    style: 'OPACITY:0 !/**/important;OPACITY:1',
    visible: false,
  },
  { name: 'stylesheet comment preserves zero', sheet: '.SUBJECT{OPACITY:0/*x*/}', visible: false },
  { name: 'comment cannot join numeric tokens', attribute: '0/**/0', visible: true },
  {
    name: 'comment cannot join a number and percent token',
    sheet: '.SUBJECT{OPACITY:1;OPACITY:0/**/%}',
    visible: true,
  },
  {
    name: 'comment cannot join a sign and number',
    parent: '0',
    attribute: '+/**/1',
    visible: false,
  },
  {
    name: 'comment cannot join a keyword',
    attribute: '0',
    style: 'OPACITY:in/**/herit',
    visible: false,
  },
  {
    name: 'trailing-dot number cannot replace zero',
    style: 'OPACITY:0;OPACITY:1.',
    visible: false,
  },
  { name: 'trailing-dot zero cannot replace one', style: 'OPACITY:1;OPACITY:0.', visible: true },
  {
    name: 'positive numeric overflow clamps to one',
    parent: '0',
    attribute: '1e999',
    visible: true,
  },
  { name: 'negative numeric overflow clamps to zero', attribute: '-1e999', visible: false },
];

function cascadeFixture(testCase: CascadeCase): string {
  return ['fill', 'stroke']
    .map((paint) => {
      const property = `${paint}-opacity`;
      const sheet =
        testCase.sheet?.replaceAll('SUBJECT', paint).replaceAll('OPACITY', property) ?? '';
      const style = testCase.style?.replaceAll('OPACITY', property) ?? '';
      const attribute =
        testCase.attribute === undefined ? '' : `${property}="${testCase.attribute}"`;
      const parent = testCase.parent === undefined ? '' : `${property}="${testCase.parent}"`;
      const shape =
        paint === 'fill'
          ? '<rect width="10" height="10" fill="red"'
          : '<path d="M1 1L9 9" fill="none" stroke="blue"';
      return `<style>${sheet}</style><g ${parent}>${shape} class="${paint}" ${attribute} style="${style}"/></g>`;
    })
    .join('');
}

// Paint opacity inherits as a value. Unlike overall group opacity, a child's
// explicit fill/stroke opacity can replace its parent's zero and become visible.
describe.each(parsers)('SVG paint opacity through %s', (_name, parse) => {
  it.each(cascadeCases)('$name', async (testCase) => {
    const result = await parse(svg(cascadeFixture(testCase)));
    expect(colors(result)).toEqual(testCase.visible ? ['#ff0000', '#0000ff'] : []);
  });

  it('leaves non-opacity inline value parsing unchanged when a stylesheet is present', async () => {
    const result = await parse(
      svg(
        '<style>rect{stroke:none}</style><rect width="10" height="10" fill="blue" style="fill:r/**/ed"/>',
      ),
    );
    expect(colors(result)).toEqual(['#0000ff']);
  });

  it('rejects comments splitting an opacity property name', async () => {
    const result = await parse(
      svg(
        '<style>rect{fill-/**/opacity:0}path{stroke-/**/opacity:0}</style>' +
          '<rect width="10" height="10" fill="red" style="fill-/**/opacity:0"/>' +
          '<path d="M1 1L9 9" fill="none" stroke="blue" style="stroke-/**/opacity:0"/>',
      ),
    );
    expect(colors(result)).toEqual(['#ff0000', '#0000ff']);
  });

  it.each(['1', '50%', '5e-1', 'initial'])(
    'keeps visible children overriding inherited zero with %s',
    async (value) => {
      const result = await parse(
        svg(
          `<g fill="red" fill-opacity="0"><rect width="10" height="10" fill-opacity="${value}"/></g>` +
            `<g fill="none" stroke="blue" stroke-opacity="0"><path d="M1 1L9 9" stroke-opacity="${value}"/></g>`,
        ),
      );
      expect(colors(result)).toEqual(['#ff0000', '#0000ff']);
    },
  );

  it.each(['', 'inherit', 'unset', 'invalid', '0garbage'])(
    'preserves inherited zero for an absent, inherited or invalid value: %s',
    async (value) => {
      const result = await parse(
        svg(
          `<g fill="red" fill-opacity="0"><rect width="10" height="10" fill-opacity="${value}"/></g>` +
            `<g fill="none" stroke="blue" stroke-opacity="0"><path d="M1 1L9 9" stroke-opacity="${value}"/></g>`,
        ),
      );
      expect(result.object).toBeNull();
    },
  );

  it('resolves paint opacity from stylesheets and inline styles before attributes', async () => {
    const result = await parse(
      svg(
        '<style>.visible { fill-opacity: 100% !important; stroke-opacity: 100% !important; }</style>' +
          '<g fill="red" fill-opacity="0"><rect class="visible" width="10" height="10" fill-opacity="0" style="fill-opacity:0"/></g>' +
          '<g fill="none" stroke="blue" stroke-opacity="0"><path d="M1 1L9 9" stroke-opacity="0" style="stroke-opacity:initial !important"/></g>',
      ),
    );
    expect(colors(result)).toEqual(['#ff0000', '#0000ff']);
  });

  it('ignores invalid opacity styles and falls back to valid presentation attributes', async () => {
    const result = await parse(
      svg(
        '<g fill="red" fill-opacity="0"><rect width="10" height="10" fill-opacity="1" style="fill-opacity:0garbage"/></g>' +
          '<g fill="none" stroke="blue" stroke-opacity="0"><path d="M1 1L9 9" stroke-opacity="1" style="stroke-opacity:0garbage"/></g>',
      ),
    );
    expect(colors(result)).toEqual(['#ff0000', '#0000ff']);
  });

  it.each(['inherit', 'unset'])(
    'lets an explicit style %s inherit zero instead of taking the positive attribute',
    async (value) => {
      const result = await parse(
        svg(
          `<g fill="red" fill-opacity="0"><rect width="10" height="10" fill-opacity="1" style="fill-opacity:${value}"/></g>` +
            `<g fill="none" stroke="blue" stroke-opacity="0"><path d="M1 1L9 9" stroke-opacity="1" style="stroke-opacity:${value}"/></g>`,
        ),
      );
      expect(result.object).toBeNull();
    },
  );

  it('keeps zero group opacity hidden despite positive child paint and group opacity', async () => {
    const result = await parse(
      svg(
        '<g opacity="0"><rect width="10" height="10" fill="red" fill-opacity="1" opacity="1"/>' +
          '<path d="M1 1L9 9" fill="none" stroke="blue" stroke-opacity="initial" opacity="1"/></g>',
      ),
    );
    expect(result.object).toBeNull();
  });
});

it('inherits paint fractions without compounding them, while group opacity still multiplies', () => {
  const doc = new DOMParser().parseFromString(
    svg(
      '<g opacity="0.5" fill-opacity="0.25" stroke-opacity="0.5"><rect opacity="0.5" fill-opacity="75%" stroke-opacity="inherit"/></g>',
    ),
    'image/svg+xml',
  );
  const group = doc.querySelector('g');
  const rect = doc.querySelector('rect');
  if (group === null || rect === null) throw new Error('Expected opacity fixture elements');
  const cascade = createSvgStyleCascade(doc.documentElement);
  const parent = presentationStateFor(group, INITIAL_PRESENTATION_STATE, cascade);
  const child = presentationStateFor(rect, parent, cascade);
  expect(child.fillOpacity).toBe(0.75);
  expect(child.strokeOpacity).toBe(0.5);
  expect(child.opacity).toBe(0.25);
});
