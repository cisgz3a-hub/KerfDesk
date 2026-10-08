import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { createImageMaskPixelTest } from '../../core/raster/image-mask';
import { exportSceneSvg } from './export-scene-svg';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgWorkerDocument } from './parse-svg-worker';

const ATTRIBUTE = 'data-kerfdesk-artwork-origin';
const identity = { id: 'origin', source: 'origin.svg' };
const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLSsAAAAASUVORK5CYII=';
const ring = (x: number, y: number, size: number) => ({
  closed: true,
  points: [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ],
});
const vector: ImportedSvg = {
  kind: 'imported-svg',
  id: 'vector',
  source: 'vector.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: { ...IDENTITY_TRANSFORM, x: -35, y: 20 },
  paths: [{ color: '#ff0000', fillRule: 'evenodd', polylines: [ring(0, 0, 10), ring(3, 3, 4)] }],
};
const image: RasterImage = {
  kind: 'raster-image',
  id: 'image',
  source: 'image.png',
  dataUrl: pixel,
  pixelWidth: 20,
  pixelHeight: 10,
  bounds: { minX: -2, minY: 4, maxX: 18, maxY: 14 },
  transform: {
    ...IDENTITY_TRANSFORM,
    x: -80,
    y: 35,
    scaleX: 2,
    scaleY: 3,
    rotationDeg: 90,
    mirrorX: true,
  },
  color: '#808080',
  dither: 'grayscale',
  linesPerMm: 10,
};

function exported(objects: readonly SceneObject[], selected?: readonly string[]): string {
  const base = createProject();
  const result = exportSceneSvg(
    {
      ...base,
      scene: {
        ...base.scene,
        objects,
        layers: [createLayer({ id: 'fill', color: '#ff0000', mode: 'fill' })],
      },
    },
    selected,
  );
  if (result.kind !== 'ok') throw new Error(result.error);
  return result.value.svg;
}

type Parser = (svgText: string) => Promise<ParseSvgResult>;
const parsers: readonly (readonly [string, Parser])[] = [
  ['browser fallback', async (svgText) => parseSvg({ svgText, ...identity })],
  [
    'worker stream',
    async (svgText) =>
      parseSvgWorkerDocument(
        await readSvgDocumentFromBlob(new NodeBlob([svgText], { type: 'image/svg+xml' }) as Blob),
        identity,
      ),
  ],
];
const physical = (
  attributes = '',
  body = '<path d="M10 20L110 120" fill="none" stroke="black"/>',
) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="10 20 100 100" ${attributes}>${body}</svg>`;

describe.each(parsers)('explicit artwork origin through %s', (_name, parse) => {
  it('translates a physical root and its bounds in millimetres after aspect mapping', async () => {
    const result = await parse(physical(`${ATTRIBUTE}="v1 -7.5e1 +2.5e1"`));
    expect(result.object?.bounds).toEqual({ minX: -75, minY: 25, maxX: 125, maxY: 125 });
    expect(result.fragment?.bounds).toEqual(result.object?.bounds);
    expect(result.object?.paths[0]?.polylines[0]?.points).toEqual([
      { x: -25, y: 25 },
      { x: 75, y: 125 },
    ]);
  });

  it.each([
    '',
    'v2 -75 25',
    '1 -75 25',
    'v1 -75',
    'v1 -75 25 0',
    'v1 NaN 25',
    'v1 -75 Infinity',
    'v1 -75 -Infinity',
    'v1 1e309 25',
    'v1 -75px 25',
    'v1 0x10 25',
    'v1 -75,25',
    'v1 -75;25',
  ])('ignores unsupported or malformed origin metadata: %s', async (value) => {
    expect(await parse(physical(`${ATTRIBUTE}="${value}"`))).toEqual(await parse(physical()));
  });

  it('uses neither human-readable provenance nor nested metadata to opt in', async () => {
    const result = await parse(
      physical(
        '',
        `<desc>KerfDesk artwork. Text is outlined; machine settings are not included.</desc>` +
          `<g ${ATTRIBUTE}="v1 -75 25"><title>KerfDesk</title>` +
          '<path d="M10 20L110 120" fill="none" stroke="black"/></g>',
      ),
    );
    expect(result.object?.paths[0]?.polylines[0]?.points).toEqual([
      { x: 50, y: 0 },
      { x: 150, y: 100 },
    ]);
  });

  it('keeps explicit root viewport clipping in the translated physical frame', async () => {
    const result = await parse(
      physical(
        `${ATTRIBUTE}="v1 -75 25" preserveAspectRatio="xMidYMid slice" overflow="hidden"`,
        '<rect x="10" y="20" width="100" height="100"/>',
      ),
    );
    const points = result.object?.paths[0]?.polylines[0]?.points ?? [];
    expect(Math.min(...points.map((point) => point.x))).toBe(-75);
    expect(Math.max(...points.map((point) => point.x))).toBe(125);
    expect(Math.min(...points.map((point) => point.y))).toBe(25);
    expect(Math.max(...points.map((point) => point.y))).toBe(125);
    expect(result.fragment?.bounds).toEqual({ minX: -75, minY: 25, maxX: 125, maxY: 125 });
  });

  it('never enables rendering disabled by a zero viewBox', async () => {
    const result = await parse(
      physical(`${ATTRIBUTE}="v1 -75 25"`).replace('10 20 100 100', '0 0 0 100'),
    );
    expect(result.object).toBeNull();
    expect(result.fragment?.entries).toEqual([]);
  });

  it('exports the selected page origin and restores vector holes at their scene positions', async () => {
    const other = { ...vector, id: 'other', transform: { ...IDENTITY_TRANSFORM, x: 200, y: 100 } };
    const text = exported([vector, other], [vector.id]);
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    expect(doc.documentElement.getAttribute(ATTRIBUTE)).toBe('v1 -35 20');
    expect(doc.querySelectorAll('[id^="artwork-"]')).toHaveLength(1);
    const result = await parse(text);
    expect(result.fragment?.bounds).toEqual({ minX: -35, minY: 20, maxX: -25, maxY: 30 });
    expect(result.object?.paths[0]?.polylines).toHaveLength(2);
    expect(result.object?.paths[0]?.polylines[0]?.points[0]).toEqual({ x: -35, y: 20 });
    expect(result.object?.paths[0]?.polylines[1]?.points[0]).toEqual({ x: -32, y: 23 });
    expect(result.object?.paths[0]?.fillRule).toBe('evenodd');
  });

  it('retains negative image placement, unequal mirrored scale and an owned local clip', async () => {
    const owned = { ...image, imageClip: [{ color: '#000000', polylines: [ring(-2, 4, 10)] }] };
    const result = await parse(exported([owned]));
    const entry = result.fragment?.entries[0];
    if (entry?.kind !== 'svg-image') throw new Error('Expected image');
    for (const point of [
      { x: -2, y: 4 },
      { x: 18, y: 4 },
      { x: -2, y: 14 },
    ]) {
      const actual = applyTransform(point, entry.transform);
      const expected = applyTransform(point, image.transform);
      expect(actual.x).toBeCloseTo(expected.x, 10);
      expect(actual.y).toBeCloseTo(expected.y, 10);
    }
    expect(entry.bounds).toEqual(image.bounds);
    const contains = createImageMaskPixelTest(
      { ...owned, ...entry, kind: 'raster-image' },
      null,
      20,
      10,
    );
    expect(contains?.(0, 0)).toBe(true);
    expect(contains?.(19, 9)).toBe(false);
    expect(result.object).toBeNull();
  });

  it('falls back to standard placement when an older export carries no explicit origin', async () => {
    const legacy = exported([vector]).replace(/\sdata-kerfdesk-artwork-origin="[^"]*"/, '');
    const result = await parse(legacy);
    expect(result.object?.paths[0]?.polylines[0]?.points[0]).toEqual({ x: 0, y: 0 });
    expect(result.fragment?.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });
});
