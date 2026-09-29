import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgInWorker, parseSvgWorkerDocument } from './parse-svg-worker';

const identity = { id: 'source', source: 'opacity.svg' };
const image =
  '<image width="10" height="10" preserveAspectRatio="none" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLSsAAAAASUVORK5CYII="';
const svg = (content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${content}</svg>`;

type Parser = (svgText: string) => ParseSvgResult | Promise<ParseSvgResult>;
const parsers: readonly (readonly [string, Parser])[] = [
  ['browser fallback', (svgText) => parseSvg({ svgText, ...identity })],
  ['worker text', (svgText) => parseSvgInWorker({ svgText, ...identity })],
  [
    'worker stream',
    async (svgText) =>
      parseSvgWorkerDocument(
        await readSvgDocumentFromBlob(new NodeBlob([svgText], { type: 'image/svg+xml' }) as Blob),
        identity,
      ),
  ],
];

// ADR-358 Amendment 3: an image KerfDesk cannot engrave as drawn is skipped
// with a warning, and the rest of the file still imports.
const vector = '<path d="M0 0H5" stroke="red"/>';
const skippedForOpacity =
  'SVG presentation: Skipped 1 embedded image(s) because they have opacity, a filter or a mask, which an engraved image cannot reproduce; the rest of the file imported.';

describe.each(parsers)('SVG image opacity through %s', (_name, parse) => {
  it.each(['0.5', '50%', '0.5%', '5e1%', ' 50% '])(
    'skips an image with unrepresentable opacity %s and imports the rest',
    async (opacity) => {
      const parsed = await parse(svg(`${vector}${image} opacity="${opacity}"/>`));
      expect(parsed.fragment?.entries.map((entry) => entry.kind)).toEqual(['imported-svg']);
      expect(parsed.notes).toContain(skippedForOpacity);
    },
  );

  it.each([
    `${image} opacity="1" style="opacity:50% !important"/>`,
    `<g opacity="50%">${image}/></g>`,
    `<g style="opacity:50%"><g opacity="100%">${image}/></g></g>`,
  ])('skips images under percentage opacity from style or ancestor groups', async (content) => {
    const parsed = await parse(svg(`${vector}${content}`));
    expect(parsed.fragment?.entries.map((entry) => entry.kind)).toEqual(['imported-svg']);
    expect(parsed.notes).toContain(skippedForOpacity);
  });

  it.each([
    '',
    'opacity="1"',
    'opacity="100%"',
    'opacity="150%"',
    'opacity="0.5" style="opacity:100%"',
  ])('accepts opaque images with %s', async (attributes) => {
    const parsed = await parse(svg(`${image} ${attributes}/>`));
    expect(parsed.fragment?.entries).toHaveLength(1);
    expect(parsed.fragment?.entries[0]?.kind).toBe('svg-image');
    expect(parsed.notes).toEqual([]);
  });

  it.each(['0', '0%', '-50%'])(
    'omits fully transparent images with opacity %s without rejecting the file',
    async (opacity) => {
      const parsed = await parse(svg(`${image} opacity="${opacity}"/>`));
      expect(parsed.fragment?.entries).toEqual([]);
      expect(parsed.notes).toEqual(['SVG has no drawable geometry']);
    },
  );
});
