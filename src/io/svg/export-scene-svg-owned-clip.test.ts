import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type RasterImage,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { exportSceneSvg } from './export-scene-svg';
import { parseSvg } from './parse-svg';

function rectangle(minX: number, minY: number, maxX: number, maxY: number): ColoredPath {
  return {
    color: '#ff0000',
    polylines: [
      {
        closed: true,
        points: [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ],
      },
    ],
  };
}

const image: RasterImage = {
  kind: 'raster-image',
  id: 'image',
  source: 'source.png',
  dataUrl: 'data:image/png;base64,AQID',
  lumaBase64: 'AAAAAA==',
  pixelWidth: 2,
  pixelHeight: 2,
  bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
  transform: { ...IDENTITY_TRANSFORM, x: -12, y: 17, mirrorX: true, rotationDeg: 90, scaleY: 2 },
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 1,
  imageClip: [rectangle(0, 0, 3, 4), rectangle(1, 1, 2, 2)],
};

function exported(objects: readonly SceneObject[]): Document {
  const base = createProject();
  const result = exportSceneSvg({ ...base, scene: { ...base.scene, objects } }, ['image']);
  if (result.kind !== 'ok') throw Error(result.error);
  expect(result.value.objectCount).toBe(1);
  return new DOMParser().parseFromString(result.value.svg, 'image/svg+xml');
}

describe('owned SVG image clips', () => {
  it('preserves one compound even-odd clip under the image transform and source bytes', () => {
    const doc = exported([image]);
    expect(doc.querySelectorAll('clipPath')).toHaveLength(1);
    expect(doc.querySelectorAll('clipPath > path')).toHaveLength(1);
    expect(doc.querySelector('image')?.getAttribute('xlink:href')).toBe(image.dataUrl);
    expect(doc.querySelector('clipPath path')?.getAttribute('transform')).toBe(
      doc.querySelector('image')?.getAttribute('transform'),
    );
    expect(doc.querySelector('clipPath path')?.getAttribute('clip-rule')).toBe('evenodd');
    for (const [local, inside] of [
      [{ x: 0.5, y: 0.5 }, true],
      [{ x: 1.5, y: 1.5 }, false],
      [{ x: 3.5, y: 1.5 }, false],
    ] as const) {
      expect(
        clipIncludes(doc.querySelector('clipPath')!, applyTransform(local, image.transform)),
      ).toBe(inside);
    }
    expect(doc.querySelector('[id^="artwork-"]')).toBeNull();
  });

  it('nests independent clip groups so an external mask intersects the owned clip', () => {
    const mask: ImportedSvg = {
      kind: 'imported-svg',
      id: 'external',
      source: 'mask.svg',
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 4 },
      transform: { ...IDENTITY_TRANSFORM, x: -20, y: 15 },
      paths: [rectangle(0, 0, 8, 2)],
    };
    const doc = exported([{ ...image, imageMaskId: mask.id }, mask]);
    const groups: Element[] = [];
    for (
      let element = doc.querySelector('image')?.parentElement;
      element != null;
      element = element.parentElement
    ) {
      if (element.hasAttribute('clip-path')) groups.push(element);
    }
    expect(groups).toHaveLength(2);
    const clipIds = groups.map((group) => group.getAttribute('clip-path')!.slice(5, -1));
    expect(new Set(clipIds).size).toBe(2);
    for (const [local, inside] of [
      [{ x: 0.5, y: 0.5 }, true],
      [{ x: 1.5, y: 1.5 }, false],
      [{ x: 2.5, y: 0.5 }, false],
      [{ x: 3.5, y: 0.5 }, false],
    ] as const) {
      const point = applyTransform(local, image.transform);
      expect(clipIds.every((id) => clipIncludes(doc.getElementById(id)!, point))).toBe(inside);
    }
    expect(doc.querySelector('[id^="artwork-"]')).toBeNull();
  });

  it('keeps native curves and an explicitly empty owned clip on export', () => {
    const arc: ColoredPath = {
      color: '#000000',
      polylines: [],
      curves: [
        {
          start: { x: 0, y: 0 },
          closed: true,
          segments: [
            {
              kind: 'elliptical-arc',
              radiusX: 2,
              radiusY: 1,
              rotationDeg: 17,
              largeArc: false,
              sweep: true,
              to: { x: 4, y: 0 },
            },
          ],
        },
      ],
    };
    const curve = exported([{ ...image, imageClip: [arc] }]);
    expect(curve.querySelector('clipPath path')?.getAttribute('d')).toBe(
      'M 0 0 A 2 1 17 0 1 4 0 Z',
    );
    const empty = exported([{ ...image, imageClip: [] }]);
    expect(empty.querySelector('image')?.parentElement?.getAttribute('clip-path')).toBe(
      'url(#image-clip-0)',
    );
    expect(empty.querySelector('clipPath path')?.getAttribute('d')).toBe('');
  });
});

function clipIncludes(clip: Element, point: Vec2): boolean {
  const shape = clip.querySelector('path')!.cloneNode(true) as Element;
  shape.setAttribute('fill', '#000000');
  const parsed = parseSvg({
    svgText:
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">' +
      shape.outerHTML +
      '</svg>',
    id: 'probe',
    source: 'probe.svg',
  });
  if (parsed.object === null) throw Error('Expected exported vector clip.');
  let inside = false;
  for (const contour of parsed.object.paths.flatMap((path) => path.polylines)) {
    for (let index = 0; index < contour.points.length; index += 1) {
      const a = contour.points[index]!,
        b = contour.points[(index + 1) % contour.points.length]!;
      if (a.y > point.y === b.y > point.y) continue;
      if (point.x < a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
    }
  }
  return inside;
}
