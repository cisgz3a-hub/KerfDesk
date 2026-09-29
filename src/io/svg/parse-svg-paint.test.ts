import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgWorkerDocument } from './parse-svg-worker';

// Colour is the operation key, so these pin which layer each paint lands on.
const identity = { id: 'paint', source: 'paint.svg' };
const svg = (content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">${content}</svg>`;

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

const colours = (result: ParseSvgResult) => result.object?.paths.map((path) => path.color) ?? [];
const entryKinds = (result: ParseSvgResult) =>
  (result.fragment?.entries ?? []).map((entry) =>
    entry.kind === 'imported-svg'
      ? `${entry.operationOverride?.mode ?? '-'}:${entry.paths.map((path) => path.color).join('+')}`
      : entry.kind,
  );
const presentationNotes = (result: ParseSvgResult) =>
  result.notes.filter((note) => note.startsWith('SVG presentation:'));

describe.each(parsers)('SVG paint through %s', (_name, parse) => {
  it('keeps cairo-style percentage rgb() colours as separate operations', async () => {
    const result = await parse(
      svg(
        '<path fill="none" stroke="rgb(100%, 0%, 0%)" d="M10 10H40V40Z"/>' +
          '<path fill="rgb(0%, 0%, 100%)" d="M50 50H80V80Z"/>',
      ),
    );
    expect(colours(result)).toEqual(['#ff0000', '#0000ff']);
  });

  it('paints nothing for transparent colours', async () => {
    const result = await parse(
      svg(
        '<rect width="100" height="100" fill="transparent" stroke="rgba(0, 0, 0, 0)"/>' +
          '<rect width="10" height="10" fill="#ff000000"/>' +
          '<circle cx="50" cy="50" r="20" fill="none" stroke="#ff0000"/>',
      ),
    );
    expect(colours(result)).toEqual(['#ff0000']);
  });

  it('inherits for inherit and for an invalid paint, as CSS ignores it', async () => {
    const result = await parse(
      svg(
        '<g fill="#00ff00"><rect width="10" height="10" fill="inherit"/></g>' +
          '<g stroke="blue" fill="none"><path d="M0 50H90" stroke="not-a-colour"/></g>',
      ),
    );
    expect(colours(result)).toEqual(['#00ff00', '#0000ff']);
  });

  it('paints currentColor with the painting element’s own color', async () => {
    const result = await parse(
      svg(
        '<g color="red" fill="currentColor">' +
          '<rect width="10" height="10"/>' +
          '<rect x="20" width="10" height="10" style="color: blue"/>' +
          '</g>',
      ),
    );
    expect(colours(result)).toEqual(['#ff0000', '#0000ff']);
  });

  it('paints a gradient with its first visible stop and says so', async () => {
    const result = await parse(
      svg(
        '<defs>' +
          '<linearGradient id="base"><stop offset="0" stop-color="red" stop-opacity="0"/>' +
          '<stop offset="1" style="stop-color: #00ff00"/></linearGradient>' +
          '<radialGradient id="derived" xlink:href="#base" xmlns:xlink="http://www.w3.org/1999/xlink"/>' +
          '<linearGradient id="empty"/>' +
          '</defs>' +
          '<rect width="10" height="10" fill="url(#base)"/>' +
          '<path d="M0 50H90" fill="none" stroke="url(#derived)"/>' +
          '<rect y="80" width="10" height="10" fill="url(#empty)"/>',
      ),
    );
    expect(entryKinds(result)).toEqual(['fill:#00ff00', 'line:#00ff00']);
    expect(presentationNotes(result)).toEqual([
      "SVG presentation: Imported 2 SVG element(s) painted with a gradient in one solid colour, the gradient's first visible stop.",
    ]);
  });

  it('skips a pattern paint, image fills included, and says so', async () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLSsAAAAASUVORK5CYII=';
    const result = await parse(
      svg(
        '<defs><pattern id="photo" width="1" height="1" patternContentUnits="objectBoundingBox">' +
          '<use href="#img" transform="scale(0.01)"/></pattern>' +
          `<image id="img" width="100" height="100" href="${png}"/></defs>` +
          '<rect width="100" height="50" fill="url(#photo)"/>' +
          '<rect y="60" width="10" height="10" fill="url(#photo)" stroke="#0000ff"/>',
      ),
    );
    expect(entryKinds(result)).toEqual(['line:#0000ff']);
    expect(presentationNotes(result)).toEqual([
      'SVG presentation: Skipped the pattern paint of 2 SVG element(s); pattern fills, including image fills, are not imported.',
    ]);
  });

  it('paints an unresolvable paint server reference with its fallback or not at all', async () => {
    const result = await parse(
      svg(
        '<rect width="50" height="50" fill="url(#missing)"/>' +
          '<rect x="60" width="10" height="10" fill="url(#missing) #ff00ff"/>' +
          '<rect x="80" width="10" height="10" fill="url(#missing) none" stroke="url(other.svg#g) red"/>',
      ),
    );
    expect(entryKinds(result)).toEqual(['fill:#ff00ff', 'line:#ff0000']);
    expect(presentationNotes(result)).toEqual([]);
  });
});
