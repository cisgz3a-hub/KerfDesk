import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgInWorker, parseSvgWorkerDocument } from './parse-svg-worker';
import { parseSvgPaintOpacity } from './svg-paint-opacity';

const identity = { id: 'variable-opacity', source: 'variable-opacity.svg' };
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
const notes = (result: ParseSvgResult) =>
  result.notes.filter((note) => note.includes('unresolved fill or stroke opacity'));
const valid = [
  'var(--missing, 1)',
  'var(--missing, 0)',
  'var(--missing)',
  'var(--missing,)',
  'var(--missing, var(--other, .5))',
  'calc(var(--missing, 1) / 2)',
  'var(--missing) junk',
  'var(--missing, red, blue)',
  'var(--missing, 1',
  String.raw`v\61 r(--missing, 1)`,
  'var(/*name*/--missing/**/,/**/1)',
  'foo(var(--missing, 1))',
  'calc(1 + var(--missing, 0) junk)',
  'var(--missing, (1;2))',
  'var(--missing, [!])',
  String.raw`var(--\6d issing, 1)`,
  'env(missing, 1)',
  'env(missing, 0)',
  'env(missing)',
  'env(missing,)',
  'env(missing 0 1, .5)',
  'env(missing +1 -0, 1)',
  'env(missing, env(other, 1))',
  'env(missing, var(--other, 1))',
  'var(--missing, env(other, 1))',
  'calc(1 + env(missing, 0) junk)',
  'foo(env(missing, 1))',
  'env(missing, 1',
  'env(missing, [!])',
  'env(missing, (1;2))',
  String.raw`e\6e v(missing, 1)`,
  String.raw`env(\6d issing, 1)`,
  // Chrome accepts these names despite the env draft's custom-ident wording.
  // Preserve them with a warning rather than silently exposing lower opacity.
  'env(initial, 1)',
  'env(inherit, 1)',
  'env(unset, 1)',
  'env(revert, 1)',
  'env(revert-layer, 1)',
  'env(default, 1)',
];
const invalid = [
  'var()',
  'var(missing, 1)',
  'var(--, 1)',
  'var(--missing 1)',
  'var(--missing))',
  'var(--missing, var(other, 1))',
  'var(--missing, !)',
  'var(--missing, 1;2)',
  'var(--missing) !important',
  'var(--missing) ]',
  'var(--missing, url(bad url))',
  '"var(--missing)"',
  'var(--missing/**/tail, 1)',
  'var(--missing, 1!important)',
  'env()',
  'env(1, 1)',
  'env("missing", 1)',
  'env(missing extra, 1)',
  'env(missing -1, 1)',
  'env(missing 1.0, 1)',
  'env(missing 1e0, 1)',
  'env(missing, 1;2)',
  'env(missing, !important)',
  'env(missing, var(other, 1))',
  'var(--missing, env(1, 1))',
  'var(--missing, env(missing -1, 1))',
  'env(missing, env(, 1))',
];

describe('variable paint opacity declaration syntax', () => {
  it.each(valid)('retains a pending substitution: %s', (value) => {
    expect(parseSvgPaintOpacity(value)).toBe('unresolved');
  });
  it.each(invalid)('rejects invalid variable syntax: %s', (value) => {
    expect(parseSvgPaintOpacity(value)).toBeNull();
  });
});

describe.each(parsers)('variable paint opacity through %s', (_name, parse) => {
  describe.each(['fill', 'stroke'])('%s', (paint) => {
    const property = `${paint}-opacity`;
    const shape = (attributes: string) =>
      `<rect width="10" height="10" fill="${paint === 'fill' ? 'red' : 'none'}" stroke="${paint === 'stroke' ? 'blue' : 'none'}" ${attributes}/>`;

    it.each([
      'var(--missing, 1)',
      'var(--missing, 0)',
      'var(--missing)',
      'calc(var(--missing, 1) / 2)',
      'env(missing, 1)',
      'env(missing, 0)',
      'env(missing)',
      'env(missing 0 1, .5)',
      'env(missing, var(--other, 1))',
      'var(--missing, env(other, 1))',
    ])(
      'retains a valid winning %s and warns without guessing its computed value',
      async (value) => {
        const result = await parse(
          svg(`<style>.x{${property}:0}</style>${shape(`class="x" style="${property}:${value}"`)}`),
        );
        expect(result.object?.paths).toHaveLength(1);
        expect(notes(result)).toHaveLength(1);
        expect(notes(result)[0]).toContain('variables');
      },
    );

    it('retains the unresolved winner when a custom property is defined as zero', async () => {
      const result = await parse(
        svg(shape(`style="--value:0;${property}:0;${property}:var(--value)"`)),
      );
      expect(result.object?.paths).toHaveLength(1);
      expect(notes(result)).toHaveLength(1);
    });

    it('retains stylesheet and raw presentation-attribute variable winners', async () => {
      const result = await parse(
        svg(
          `<style>.x{${property}:0}.x{${property}:var(--missing,1)}</style>${shape('class="x"')}${shape(`${property}="var(--missing,0)"`)}`,
        ),
      );
      expect(result.object?.paths.flatMap((path) => path.polylines)).toHaveLength(2);
      expect(notes(result)).toHaveLength(1);
      expect(notes(result)[0]).toContain('Imported 2 SVG element(s)');
    });

    it('does not warn when a numeric important declaration defeats a variable', async () => {
      const result = await parse(
        svg(
          `<style>.x{${property}:0!important}</style>${shape(`class="x" style="${property}:var(--missing,1)"`)}`,
        ),
      );
      expect(result.object).toBeNull();
      expect(notes(result)).toEqual([]);
    });

    it('retains environment winners in stylesheets and attributes, with child overrides', async () => {
      const result = await parse(
        svg(
          `<style>.x{${property}:0}.x{${property}:env(missing,1)!important;${property}:0}</style>${shape('class="x"')}<g ${property}="env(missing,0)">${shape('')}${shape(`${property}="initial"`)}${shape(`${property}="0"`)}</g>`,
        ),
      );
      expect(result.object?.paths.flatMap((path) => path.polylines)).toHaveLength(3);
      expect(notes(result)).toHaveLength(1);
      expect(notes(result)[0]).toContain('Imported 2 SVG element(s)');
      expect(notes(result)[0]).toContain('environment');
    });

    it.each([
      'var(missing, 1)',
      'var(--, 1)',
      'var(--missing 1)',
      'var(--missing, var(other))',
      'env(missing -1, 1)',
      'env(missing 1.0, 1)',
      'env(missing 1px, 1)',
      'var(--missing, env(1, 1))',
      'env(missing, var(other))',
    ])('invalid %s leaves lower zero in effect without an approximation warning', async (value) => {
      const result = await parse(svg(shape(`style="${property}:0;${property}:${value}"`)));
      expect(result.object).toBeNull();
      expect(notes(result)).toEqual([]);
    });

    it('preserves importance and lets explicit child values clear uncertainty', async () => {
      const result = await parse(
        svg(
          `<g style="${property}:var(--missing, 0)!important;${property}:0">${shape('')}${shape(`${property}="initial"`)}${shape(`${property}="0"`)}</g>`,
        ),
      );
      expect(result.object?.paths.flatMap((path) => path.polylines)).toHaveLength(2);
      expect(notes(result)).toHaveLength(1);
      expect(notes(result)[0]).toContain('Imported 1 SVG element(s)');
    });
  });
});
