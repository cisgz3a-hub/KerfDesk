import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { exportSceneSvg } from './export-scene-svg';
import { parseSvg } from './parse-svg';

const square: ImportedSvg = {
  kind: 'imported-svg',
  id: 'square',
  source: 'Logo <&".svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
        {
          closed: true,
          points: [
            { x: 3, y: 3 },
            { x: 7, y: 3 },
            { x: 7, y: 7 },
            { x: 3, y: 7 },
          ],
        },
      ],
    },
  ],
};
const image: RasterImage = {
  kind: 'raster-image',
  id: 'image',
  source: 'photo.png',
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  pixelWidth: 2,
  pixelHeight: 1,
  linesPerMm: 1,
  dither: 'grayscale',
  dataUrl: 'data:image/png;base64,AQID',
};
function project(objects: readonly SceneObject[]): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      objects,
      layers: [createLayer({ id: 'fill', color: '#ff0000', mode: 'fill' })],
    },
  };
}
function exported(source: Project, ids?: readonly string[]): string {
  const result = exportSceneSvg(source, ids);
  if (result.kind !== 'ok') throw new Error(result.error);
  return result.value.svg;
}

describe('artwork SVG export', () => {
  it('keeps non-ASCII titles valid while stripping XML-forbidden metadata characters', () => {
    const svg = exported(project([{ ...square, source: '名字 & logo\u0000\ud800.svg' }]));
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('title')?.textContent).toBe('名字 & logo.svg');
  });
  it('round trips a mirrored rotated nonuniform square and its hole at physical size', () => {
    const svg = exported(
      project([
        {
          ...square,
          transform: {
            ...IDENTITY_TRANSFORM,
            x: 40,
            y: 20,
            scaleX: 2,
            scaleY: 3,
            mirrorX: true,
            rotationDeg: 90,
          },
        },
      ]),
    );
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.getAttribute('width')).toBe('30mm');
    expect(doc.documentElement.getAttribute('height')).toBe('20mm');
    expect(doc.querySelector('title')?.textContent).toBe(square.source);
    expect(doc.querySelector('path')?.getAttribute('fill-rule')).toBe('evenodd');
    const imported = parseSvg({ svgText: svg, id: 'import', source: 'roundtrip.svg' });
    const path = imported.object?.paths[0];
    expect(path?.polylines).toHaveLength(2);
    expect(path?.polylines[0]?.points.slice(0, 4)).toEqual([
      { x: 40, y: 20 },
      { x: 40, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
    ]);
    expect(path?.polylines[1]?.points[0]).toEqual({ x: 31, y: 14 });
  });

  it('uses canonical cubic and arc geometry instead of stale compatibility polylines', () => {
    const svg = exported(
      project([
        {
          ...square,
          paths: [
            {
              color: '#ff0000',
              polylines: [],
              curves: [
                {
                  start: { x: 0, y: 0 },
                  closed: false,
                  segments: [
                    {
                      kind: 'cubic',
                      control1: { x: 1, y: 2 },
                      control2: { x: 3, y: 4 },
                      to: { x: 5, y: 6 },
                    },
                    {
                      kind: 'elliptical-arc',
                      radiusX: 3,
                      radiusY: 2,
                      rotationDeg: 30,
                      largeArc: false,
                      sweep: true,
                      to: { x: 8, y: 9 },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    const d = new DOMParser()
      .parseFromString(svg, 'image/svg+xml')
      .querySelector('path')
      ?.getAttribute('d');
    expect(d).toContain('C 1 2 3 4 5 6');
    expect(d).toContain('A 3 2 30 0 1 8 9');
  });

  it('exports selection only and includes original embedded pixels with placement and mask', () => {
    const masked = {
      ...image,
      imageMaskId: square.id,
      transform: { ...IDENTITY_TRANSFORM, x: 2, rotationDeg: 20 },
    };
    const svg = exported(project([square, masked]), ['image']);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelectorAll('image')).toHaveLength(1);
    expect(doc.querySelector('image')?.getAttribute('xlink:href')).toBe(image.dataUrl);
    expect(doc.querySelector('image')?.getAttribute('width')).toBe('20');
    expect(doc.querySelector('image')?.getAttribute('transform')).toContain('matrix(');
    expect(doc.querySelector('clipPath')?.getAttribute('clipPathUnits')).toBe('userSpaceOnUse');
    expect(doc.querySelector('clipPath path')?.getAttribute('d')).toContain('M 3 3');
    expect(doc.querySelector('[id^="artwork-"]')).toBeNull();
  });

  it('does not silently skip malformed artwork, missing pixels, external images or absent selections', () => {
    expect(exportSceneSvg(project([square]), ['missing']).kind).toBe('error');
    expect(
      exportSceneSvg(project([{ ...image, dataUrl: 'https://example.org/image.png' }])).kind,
    ).toBe('error');
    expect(
      exportSceneSvg(project([{ ...image, transform: { ...IDENTITY_TRANSFORM, x: NaN } }])).kind,
    ).toBe('error');
    expect(exportSceneSvg(project([{ ...square, paths: [] }])).kind).toBe('error');
  });

  it('outlines text and includes output-disabled artwork without a machine connection', () => {
    const text = {
      ...square,
      kind: 'text' as const,
      content: 'Hello',
      color: '#ff0000',
      fontKey: 'roboto',
      sizeMm: 10,
      alignment: 'left' as const,
      lineHeight: 1.2,
      letterSpacing: 0,
    };
    const p = project([text]);
    const svg = exported({
      ...p,
      scene: { ...p.scene, layers: p.scene.layers.map((layer) => ({ ...layer, output: false })) },
    });
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelectorAll('text')).toHaveLength(0);
    expect(doc.querySelector('path')?.getAttribute('fill-rule')).toBe('nonzero');
    expect(doc.querySelector('title')?.textContent).toBe('Hello');
  });
});
