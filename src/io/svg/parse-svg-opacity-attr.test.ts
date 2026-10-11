import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgInWorker, parseSvgWorkerDocument } from './parse-svg-worker';
import { parseSvgPaintOpacity } from './svg-paint-opacity';

const identity = { id: 'attr-opacity', source: 'attr-opacity.svg' };
type Parser = (text: string) => ParseSvgResult | Promise<ParseSvgResult>;
const parsers: readonly (readonly [string, Parser])[] = [
  ['browser', (svgText) => parseSvg({ svgText, ...identity })],
  ['worker text', (svgText) => parseSvgInWorker({ svgText, ...identity })],
  [
    'worker blob',
    async (text) =>
      parseSvgWorkerDocument(await readSvgDocumentFromBlob(new NodeBlob([text]) as Blob), identity),
  ],
];
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20">${body}</svg>`;
const warnings = (result: ParseSvgResult) =>
  result.notes.filter((note) => note.includes('unresolved fill or stroke opacity'));

const valid = [
  'attr(data-v)',
  'attr(data-v,)',
  'attr(data-v number,1)',
  'attr(data-v type(<number>),1)',
  'attr(data-v type(<integer>),0)',
  'attr(data-v type(<number> | <percentage>),1)',
  'attr(data-v type(*),1)',
  'attr(data-v raw-string,1)',
  'attr(data-v %,1)',
  'attr(data-v px,1)',
  'attr(data-v em,1)',
  'attr(data-v type(<number>),var(--missing,1))',
  'var(--missing,attr(data-v number,0))',
  'env(missing,attr(data-v type(<number>),1))',
  'attr(data-v type(<number>),env(missing,1))',
  'attr(data-v number,[!])',
  'foo(attr(data-v number,1))',
  'calc(attr(data-v number,1) junk)',
  'attr(data-v number,1',
  String.raw`a\74tr(data-v number,1)`,
  'attr(data-v foo,1)',
  'attr(data-v fr,1)',
  'attr(data-v Hz,1)',
  'attr(data-v PX,1)',
  'attr(data-v TYPE(<number>),1)',
  'attr(data-v type(<number>#),1)',
  'attr(data-v type(<number>+),1)',
  'attr(data-v type(<number>/**/#),1)',
  'attr(data-v type(foo),1)',
  'attr(data-v type(foo|<number>),1)',
  'attr(data-v type(--foo),1)',
  'attr(data-v type(none),1)',
  'attr(data-v type(<string>),1)',
];
const invalid = [
  'attr()',
  'attr(,1)',
  'attr(123,1)',
  'attr("data-v",1)',
  'attr(data-v extra extra,1)',
  'attr(data-v type(<bogus>),1)',
  'attr(data-v type(<number> #),1)',
  'attr(data-v type(<number> +),1)',
  'attr(data-v type(< number>),1)',
  'attr(data-v type(<number >),1)',
  'attr(data-v type(),1)',
  'attr(data-v number,!)',
  'attr(data-v number,1;2)',
  'attr(data-v number,var(bad,1))',
  'var(--missing,attr(,1))',
  'env(missing,attr(data-v type(<bogus>),1))',
  '"attr(data-v number,1)"',
  'attr(data-v type(<NUMBER>),1)',
  'attr(data-v type("<number>"),1)',
  'attr(data-v type(<url>),1)',
  'attr(data-v type(inherit),1)',
  'attr(data-v type(<number>||<percentage>),1)',
  'attr(data-v type(<number>|),1)',
  'attr(data-v type(<transform-list>+),1)',
  // Preserve the currently observed browser grammar boundary, not a claim of
  // supporting draft-only namespaces or deferred substitution in headers.
  'attr(ns|data-v number,1)',
  'attr(|data-v number,1)',
  'attr(var(--name),1)',
  'attr(data-v var(--type),1)',
];

describe('attribute opacity substitution syntax', () => {
  it.each(valid)('retains syntactically valid substitution: %s', (value) => {
    expect(parseSvgPaintOpacity(value)).toBe('unresolved');
  });
  it.each(invalid)('preserves lower candidates for invalid syntax: %s', (value) => {
    expect(parseSvgPaintOpacity(value)).toBeNull();
  });
});

describe.each(parsers)('attribute paint opacity through %s', (_name, parse) => {
  describe.each(['fill', 'stroke'])('%s', (paint) => {
    const property = `${paint}-opacity`;
    const shape = (attributes = '') =>
      `<rect width="10" height="10" fill="${paint === 'fill' ? 'red' : 'none'}" stroke="${paint === 'stroke' ? 'blue' : 'none'}" ${attributes}/>`;
    const sheet = (value: string) =>
      `<style><![CDATA[.x{${property}:0}.x{${property}:${value}}]]></style>`;

    it.each(['1', '0'])(
      'retains a typed stylesheet winner and discloses approximation for attribute %s',
      async (amount) => {
        const result = await parse(
          svg(sheet('attr(data-v type(<number>),1)') + shape(`class="x" data-v="${amount}"`)),
        );
        expect(result.object?.paths).toHaveLength(1);
        expect(warnings(result)).toHaveLength(1);
        expect(warnings(result)[0]).toContain('attribute substitutions');
      },
    );

    it.each(['attr(data-v number,0)', 'var(--missing,attr(data-v number,0))'])(
      'retains inline substitution %s without exposing lower zero',
      async (value) => {
        const result = await parse(svg(shape(`style="${property}:0;${property}:${value}"`)));
        expect(result.object?.paths).toHaveLength(1);
        expect(warnings(result)).toHaveLength(1);
      },
    );

    it('retains presentation-attribute substitutions and clears uncertainty on overrides', async () => {
      const result = await parse(
        svg(
          `<g ${property}="attr(data-v number,0)">${shape()}${shape(`${property}="initial"`)}${shape(`${property}="0"`)}</g>`,
        ),
      );
      expect(result.object?.paths.flatMap((path) => path.polylines)).toHaveLength(2);
      expect(warnings(result)).toHaveLength(1);
      expect(warnings(result)[0]).toContain('Imported 1 SVG element(s)');
    });

    it('lets important numeric declarations defeat unresolved attr', async () => {
      const result = await parse(
        svg(
          `<style>.x{${property}:0!important}</style>` +
            shape(`class="x" style="${property}:attr(data-v number,1)"`),
        ),
      );
      expect(result.object).toBeNull();
      expect(warnings(result)).toEqual([]);
    });

    it.each(['attr(,1)', 'var(--missing,attr(,1))', 'attr(data-v type(<bogus>),1)'])(
      'invalid %s keeps lower zero without warning',
      async (value) => {
        const result = await parse(svg(sheet(value) + shape('class="x"')));
        expect(result.object).toBeNull();
        expect(warnings(result)).toEqual([]);
      },
    );
  });
});

// linkedom XML getAttribute() escapes Attr.value again. Read opacity's parsed
// attribute value once, as native DOM does. jsdom's DOMPurify serializer has a
// separate XML-attribute issue; real Chrome main-route checks cover that seam.
describe.each(parsers.slice(1))('XML-encoded attribute opacity through %s', (_name, parse) => {
  describe.each(['fill', 'stroke'])('%s', (paint) => {
    const property = `${paint}-opacity`;
    const shape = (attributes: string) =>
      `<rect width="10" height="10" fill="${paint === 'fill' ? 'red' : 'none'}" stroke="${paint === 'stroke' ? 'blue' : 'none'}" ${attributes}/>`;
    it.each(['&lt;number&gt;', '&#60;number&#62;'])(
      'reads decoded inline and presentation values for %s',
      async (type) => {
        const value = `attr(data-v type(${type}),1)`;
        const result = await parse(
          svg(
            shape(`style="${property}:0;${property}:${value}"`) +
              `<g ${property}="0">${shape(`${property}="${value}"`)}</g>`,
          ),
        );
        expect(result.object?.paths.flatMap((path) => path.polylines)).toHaveLength(2);
        expect(warnings(result)).toHaveLength(1);
        expect(warnings(result)[0]).toContain('Imported 2 SVG element(s)');
      },
    );
    it('preserves encoded typed attr nested in a var fallback', async () => {
      const value = 'var(--missing,attr(data-v type(&lt;number&gt;),0))';
      const result = await parse(svg(shape(`style="${property}:0;${property}:${value}"`)));
      expect(result.object?.paths).toHaveLength(1);
      expect(warnings(result)).toHaveLength(1);
    });
    it('does not decode literal entity text a second time', async () => {
      const value = 'attr(data-v type(&amp;lt;number&amp;gt;),1)';
      const result = await parse(
        svg(
          shape(`style="${property}:0;${property}:${value}"`) +
            `<g ${property}="0">${shape(`${property}="${value}"`)}</g>`,
        ),
      );
      expect(result.object).toBeNull();
      expect(warnings(result)).toEqual([]);
    });
  });
});
