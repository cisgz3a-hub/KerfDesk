import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgInWorker, parseSvgWorkerDocument } from './parse-svg-worker';

const identity = { id: 'opacity-warning', source: 'opacity-warning.svg' };
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20">${body}</svg>`;
type Parser = (svgText: string) => ParseSvgResult | Promise<ParseSvgResult>;
const parsers: readonly (readonly [string, Parser])[] = [
  ['browser', (svgText) => parseSvg({ svgText, ...identity })],
  ['worker text', (svgText) => parseSvgInWorker({ svgText, ...identity })],
  [
    'worker blob',
    async (svgText) =>
      parseSvgWorkerDocument(
        await readSvgDocumentFromBlob(new NodeBlob([svgText]) as Blob),
        identity,
      ),
  ],
];
const notes = (result: ParseSvgResult) =>
  result.notes.filter((note) => note.includes('unresolved fill or stroke opacity'));
const warning =
  'SVG presentation: Imported 1 SVG element(s) with unresolved fill or stroke opacity treated as fully opaque; opacity using CSS variables or layout-dependent values may hide artwork that is included. Resolve these expressions in your SVG editor before importing for exact visibility.';

describe.each(parsers)('unresolved paint opacity through %s', (_name, parse) => {
  describe.each(['fill', 'stroke'])('%s', (paint) => {
    const property = `${paint}-opacity`;
    const shape = (attributes = '') =>
      `<rect width="10" height="10" fill="${paint === 'fill' ? 'red' : 'none'}" stroke="${paint === 'stroke' ? 'blue' : 'none'}" ${attributes}/>`;

    it.each(['16px', '0px'])(
      'preserves valid winning relative math and discloses approximation at font-size %s',
      async (font) => {
        const result = await parse(
          svg(
            `<style>.x{${property}:0}.x{${property}:calc(1em / 1em)}</style>${shape(`class="x" style="font-size:${font}"`)}`,
          ),
        );
        expect(result.object?.paths).toHaveLength(1);
        expect(notes(result)).toEqual([warning]);
      },
    );

    it('inherits uncertainty until a numeric or initial child override clears it', async () => {
      const result = await parse(
        svg(
          `<g ${property}="calc(1em / 1px)">${shape()}${shape(`${property}="1"`)}${shape(`${property}="initial"`)}${shape(`${property}="0"`)}</g>`,
        ),
      );
      expect(result.object?.paths.flatMap((path) => path.polylines)).toHaveLength(3);
      expect(notes(result)).toEqual([warning]);
    });

    it.each(['calc(1em + 1px)', 'calc(1em + 1)', 'calc(1em / )', 'calc(1foo / 1foo)'])(
      'keeps invalid opacity %s from masking lower zero',
      async (value) => {
        const result = await parse(svg(shape(`style="${property}:0;${property}:${value}"`)));
        expect(result.object).toBeNull();
        expect(notes(result)).toEqual([]);
      },
    );

    it.each(['display="none"', 'opacity="0"'])(
      'does not warn for an unimported hidden subtree: %s',
      async (hidden) => {
        const result = await parse(
          svg(`<g ${hidden} ${property}="calc(1em / 1em)">${shape()}</g>`),
        );
        expect(result.object).toBeNull();
        expect(notes(result)).toEqual([]);
      },
    );

    it('does not warn for an unused definition', async () => {
      const result = await parse(svg(`<defs>${shape(`${property}="calc(1em / 1em)"`)}</defs>`));
      expect(notes(result)).toEqual([]);
    });
  });

  it('does not warn about unused fill opacity when importing a visible stroke', async () => {
    const result = await parse(svg('<line x2="10" stroke="blue" fill-opacity="calc(1em / 1em)"/>'));
    expect(result.object?.paths).toHaveLength(1);
    expect(notes(result)).toEqual([]);
  });

  it('does not apply vector paint uncertainty to embedded image pixels', async () => {
    const image =
      '<image width="10" height="10" preserveAspectRatio="none" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLSsAAAAASUVORK5CYII="/>';
    const result = await parse(
      svg(`<g fill-opacity="calc(1em / 1em)" stroke-opacity="calc(1em / 1em)">${image}</g>`),
    );
    expect(result.fragment?.entries.map((entry) => entry.kind)).toEqual(['svg-image']);
    expect(result.notes).toEqual([]);
  });

  it('keeps the opacity disclosure after mixed skipped-image notes', async () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLSsAAAAASUVORK5CYII=';
    const result = await parse(
      svg(
        '<rect width="10" height="10" fill-opacity="calc(1em / 1em)"/>' +
          '<image width="10" height="10" href="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"/>' +
          `<image width="10" height="10" href="${png}" opacity=".5"/>` +
          `<image width="0" height="10" href="${png}"/>`,
      ),
    );
    expect(result.notes.filter((note) => note.includes('Skipped'))).toHaveLength(3);
    expect(result.notes.at(-1)).toBe(warning);
  });
});
