import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type RasterImage,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { createImageMaskPixelTest } from '../../core/raster/image-mask';
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
    expect(parseFloat(doc.documentElement.getAttribute('height') ?? '')).toBeCloseTo(20, 12);
    expect(doc.querySelector('title')?.textContent).toBe(square.source);
    expect(doc.querySelector('path')?.getAttribute('fill-rule')).toBe('evenodd');
    const imported = parseSvg({ svgText: svg, id: 'import', source: 'roundtrip.svg' });
    const path = imported.object?.paths[0];
    expect(path?.polylines).toHaveLength(2);
    const expectedPoints = [
      { x: 40, y: 20 },
      { x: 40, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
    ];
    for (const [index, point] of expectedPoints.entries()) {
      expectPointNear(path?.polylines[0]?.points[index], point);
    }
    expectPointNear(path?.polylines[1]?.points[0], { x: 31, y: 14 });
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

  it.each([
    { edge: 500_000, scale: 0.0000254, offset: 0 },
    { edge: 0.0000004, scale: 100_000, offset: 0 },
    { edge: 500_000, scale: 4e-11, offset: 999_999 },
  ])(
    'preserves physical geometry for local edge $edge and scale $scale',
    ({ edge, scale, offset }) => {
      const source: ImportedSvg = {
        ...square,
        transform: { ...IDENTITY_TRANSFORM, x: offset, scaleX: scale },
        paths: [
          {
            color: '#ff0000',
            polylines: [
              {
                closed: false,
                points: [
                  { x: 0, y: 0 },
                  { x: edge, y: 1 },
                ],
              },
            ],
          },
        ],
      };
      const svg = exported(project([source]));
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const positions = svgLineWorldX(doc);
      expect(positions[0]).toBe(offset);
      expect(positions[1]).toBeCloseTo(offset + edge * scale, 10);
      const viewBox = doc.documentElement.getAttribute('viewBox')?.split(' ').map(Number);
      expect(viewBox?.[2]).toBe(parseFloat(doc.documentElement.getAttribute('width') ?? ''));
      expect(viewBox?.[3]).toBe(parseFloat(doc.documentElement.getAttribute('height') ?? ''));
    },
  );

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

  it.each(['separate colors', 'nonzero artwork'])(
    'keeps raster mask holes when its contours use %s',
    (variant) => {
      const contours = square.paths[0]?.polylines ?? [];
      const transform = {
        ...IDENTITY_TRANSFORM,
        x: 30,
        y: 40,
        scaleX: 1.25,
        mirrorX: true,
        rotationDeg: 90,
      };
      const mask: ImportedSvg = {
        ...square,
        transform,
        paths:
          variant === 'separate colors'
            ? contours.map((contour, index) => ({
                color: index === 0 ? '#ff0000' : '#0000ff',
                polylines: [contour],
              }))
            : [{ color: '#ff0000', fillRule: 'nonzero', polylines: contours }],
      };
      const masked = { ...image, transform, imageMaskId: mask.id };
      const svg = exported(project([mask, masked]), [image.id]);
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const rasterIncludes = createImageMaskPixelTest(masked, mask, 20, 10);
      if (rasterIncludes === null) throw new Error('Expected a valid raster mask.');
      const samples = [
        { x: 1, y: 1, inside: true },
        { x: 4, y: 4, inside: false },
        { x: 12, y: 4, inside: false },
      ];
      for (const sample of samples) {
        expect(rasterIncludes(sample.x, sample.y)).toBe(sample.inside);
        const point = applyTransform({ x: sample.x + 0.5, y: sample.y + 0.5 }, transform);
        expect(svgClipIncludes(doc, point)).toBe(sample.inside);
      }
    },
  );

  it('keeps native masked arcs with their matrix instead of stale compatibility geometry', () => {
    const mask: ImportedSvg = {
      ...square,
      transform: { ...IDENTITY_TRANSFORM, x: 20, rotationDeg: 30, scaleY: 2 },
      paths: [
        {
          color: '#ff0000',
          polylines: [],
          curves: [
            {
              start: { x: 0, y: 0 },
              closed: true,
              segments: [
                {
                  kind: 'elliptical-arc',
                  radiusX: 5,
                  radiusY: 3,
                  rotationDeg: 15,
                  largeArc: false,
                  sweep: true,
                  to: { x: 10, y: 0 },
                },
              ],
            },
          ],
        },
      ],
    };
    const svg = exported(project([mask, { ...image, imageMaskId: mask.id }]), [image.id]);
    const clip = new DOMParser()
      .parseFromString(svg, 'image/svg+xml')
      .querySelector('clipPath path');
    expect(clip?.getAttribute('d')).toBe('M 0 0 A 5 3 15 0 1 10 0 Z');
    const matrix = clip?.getAttribute('transform')?.slice(7, -1).split(' ').map(Number);
    expect(matrix?.[0]).toBeCloseTo(Math.sqrt(3) / 2, 12);
    expect(matrix?.[1]).toBeCloseTo(0.5, 12);
    expect(matrix?.[2]).toBeCloseTo(-1, 12);
    expect(matrix?.[3]).toBeCloseTo(Math.sqrt(3), 12);
    expect(matrix?.slice(4)).toEqual([20, 0]);
  });

  it('matches raster mask closure for endpoint-closed and subsequently opened contours', () => {
    const contour = square.paths[0]?.polylines[0];
    if (contour === undefined) throw new Error('Expected a contour.');
    const mask: ImportedSvg = {
      ...square,
      paths: [
        {
          color: '#ff0000',
          polylines: [{ ...contour, closed: false, points: [...contour.points, { x: 0, y: 0 }] }],
        },
      ],
    };
    const masked = { ...image, imageMaskId: mask.id };
    const svg = exported(project([mask, masked]), [image.id]);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(svgClipIncludes(doc, { x: 4.5, y: 4.5 })).toBe(true);
    const opened = {
      ...mask,
      paths: [{ color: '#ff0000', polylines: [{ ...contour, closed: false }] }],
    };
    expect(createImageMaskPixelTest(masked, opened, 20, 10)).toBeNull();
    expect(exported(project([opened, masked]), [image.id])).not.toContain('<clipPath');
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

function expectPointNear(actual: Vec2 | undefined, expected: Vec2): void {
  expect(actual?.x).toBeCloseTo(expected.x, 12);
  expect(actual?.y).toBeCloseTo(expected.y, 12);
}

function svgLineWorldX(doc: Document): readonly [number, number] {
  const path = doc.querySelector('path');
  if (path === null) throw new Error('Expected an exported line.');
  const coordinates = (path.getAttribute('d') ?? '')
    .split(' ')
    .filter((part) => part !== 'M' && part !== 'L')
    .map(Number);
  const matrix = (path.getAttribute('transform') ?? '').slice(7, -1).split(' ').map(Number);
  expect(coordinates).toHaveLength(4);
  expect(matrix).toHaveLength(6);
  const [x1, y1, x2, y2] = coordinates as [number, number, number, number];
  const [a, , c, , e] = matrix as [number, number, number, number, number, number];
  return [a * x1 + c * y1 + e, a * x2 + c * y2 + e];
}

// SVG clip children are unioned. Within each child, clip-rule controls whether
// nested contours cancel. Parse the exported geometry independently of its source.
function svgClipIncludes(doc: Document, point: Vec2): boolean {
  return Array.from(doc.querySelectorAll('clipPath > path')).some((element) => {
    const shape = element.cloneNode(true) as Element;
    shape.setAttribute('fill', '#000000');
    const parsed = parseSvg({
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" ' +
        'viewBox="0 0 100 100">' +
        shape.outerHTML +
        '</svg>',
      id: 'mask-probe',
      source: 'mask.svg',
    });
    if (parsed.object === null) throw new Error('Expected exported mask geometry.');
    let winding = 0;
    for (const polyline of parsed.object.paths.flatMap((path) => path.polylines)) {
      for (let index = 0; index < polyline.points.length; index += 1) {
        const a = polyline.points[index];
        const b = polyline.points[(index + 1) % polyline.points.length];
        if (a === undefined || b === undefined || a.y > point.y === b.y > point.y) continue;
        const crossingX = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
        if (crossingX > point.x) winding += b.y > a.y ? 1 : -1;
      }
    }
    return element.getAttribute('clip-rule') === 'evenodd'
      ? Math.abs(winding) % 2 === 1
      : winding !== 0;
  });
}
