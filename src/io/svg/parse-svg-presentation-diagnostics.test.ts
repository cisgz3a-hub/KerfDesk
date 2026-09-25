import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { encodeRgbPng } from '../../__fixtures__/perceptual/png';
import { createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { exportSceneSvg } from './export-scene-svg';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { parseSvgInWorker, parseSvgWorkerDocument } from './parse-svg-worker';
import { readSvgDocumentFromBlob } from './parse-svg-blob';

const identity = { id: 'source', source: 'effects.svg' };
const square = 'M0 0 H10 V10 H0 Z';
const outline = `<path d="${square}" fill="none" stroke="blue"/>`;
// A clip over one quarter of the square: importing the artwork unclipped would
// cut what the design hides. (A clip that hides nothing imports; see
// parse-svg-vector-clip.test.ts.)
const clip = `<defs><clipPath id="clip" clipPathUnits="userSpaceOnUse"><path d="M0 0 H5 V5 H0 Z" clip-rule="evenodd"/></clipPath></defs>`;

function svg(content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${content}</svg>`;
}

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

describe.each(parsers)('SVG presentation diagnostics through %s', (_label, parse) => {
  it.each([
    [
      'direct clipping',
      `${clip}<path d="${square}" stroke="blue" clip-path="url(#clip)"/>`,
      /vector clipping/,
    ],
    ['inherited clipping', `${clip}<g clip-path="url(#clip)">${outline}</g>`, /vector clipping/],
    [
      'clipped use',
      `${clip}<defs><path id="shape" d="${square}" stroke="blue"/></defs><use href="#shape" clip-path="url(#clip)"/>`,
      /vector clipping/,
    ],
    ['mask', `<path d="${square}" stroke="blue" mask="url(#mask)"/>`, /vector masks and filters/],
    [
      'inherited filter',
      `<g style="filter:url(#filter)">${outline}</g>`,
      /vector masks and filters/,
    ],
  ])('rejects %s instead of returning altered vector geometry', async (_name, content, message) => {
    await expect(Promise.resolve().then(() => parse(svg(content)))).rejects.toThrow(message);
  });

  it('rejects the whole file when an unsupported vector follows valid artwork', async () => {
    const content = `${outline}${clip}<path d="${square}" fill="red" clip-path="url(#clip)"/>`;
    await expect(Promise.resolve().then(() => parse(svg(content)))).rejects.toThrow(
      /vector clipping/,
    );
  });

  it('allows explicit none effects and ignores hidden or unused affected vectors', async () => {
    const result = await parse(
      svg(`${clip}
      <defs><path d="${square}" stroke="blue" filter="url(#unused)"/></defs>
      <g display="none" clip-path="url(#clip)">${outline}</g>
      <g filter="none" mask="none" clip-path="none">${outline}</g>`),
    );
    expect(result.fragment?.entries).toHaveLength(1);
    expect(result.object?.paths[0]?.polylines).toHaveLength(1);
    expect(result.notes).toEqual([]);
  });

  it('keeps stroke compatibility while disclosing explicit and inherited omitted fills', async () => {
    const result = await parse(
      svg(`
      <path d="${square}" fill="red" stroke="blue"/>
      <g fill="red" stroke="blue"><path d="${square}"/></g>`),
    );
    expect(result.object?.paths.map((path) => path.color)).toEqual(['#0000ff']);
    expect(result.fragment?.entries[0]).toMatchObject({ operationOverride: { mode: 'line' } });
    expect(result.notes).toEqual([
      'SVG presentation: Imported 2 SVG element(s) as strokes only; their fills were omitted.',
    ]);
  });

  it('does not report omitted fills for stroke-only or transparent-fill artwork', async () => {
    const result = await parse(
      svg(`${outline}
      <path d="${square}" fill="red" fill-opacity="0" stroke="blue"/>
      <path d="${square}" fill="red" stroke="blue" stroke-opacity="0"/>`),
    );
    expect(result.notes).toEqual([]);
    expect(result.fragment?.entries).toHaveLength(2);
  });

  it('retains a valid empty result when no drawable vector survives', async () => {
    const result = await parse(
      svg(`${clip}
      <path d="" stroke="blue" clip-path="url(#clip)"/>
      <g display="none" filter="url(#filter)">${outline}</g>`),
    );
    expect(result.object).toBeNull();
    expect(result.fragment?.entries).toEqual([]);
    expect(result.notes).toEqual(['SVG has no drawable geometry']);
  });

  it('continues to accept the exporter image-only clip without creating extra vectors', async () => {
    const result = await parse(exportedClippedImage());
    expect(result.object).toBeNull();
    expect(result.fragment?.entries).toHaveLength(1);
    expect(result.fragment?.entries[0]).toMatchObject({
      kind: 'svg-image',
      imageClip: [{ fillRule: 'evenodd', polylines: [{ closed: true }] }],
    });
    expect(result.notes).toEqual([]);
  });
});

function exportedClippedImage(): string {
  const png = encodeRgbPng(Uint8Array.of(0, 0, 0), 1, 1);
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'bitmap',
    source: 'bitmap.png',
    dataUrl: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    lumaBase64: 'AA==',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    imageClip: [
      {
        color: '#000000',
        fillRule: 'evenodd',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
  const project = createProject();
  const result = exportSceneSvg({ ...project, scene: { ...project.scene, objects: [image] } });
  if (result.kind === 'error') throw new Error(result.error);
  return result.value.svg;
}
