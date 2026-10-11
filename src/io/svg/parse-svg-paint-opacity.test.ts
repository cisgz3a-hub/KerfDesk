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

// Paint opacity inherits as a value. Unlike overall group opacity, a child's
// explicit fill/stroke opacity can replace its parent's zero and become visible.
describe.each(parsers)('SVG paint opacity through %s', (_name, parse) => {
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
