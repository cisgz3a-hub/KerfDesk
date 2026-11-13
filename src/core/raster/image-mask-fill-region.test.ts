import { describe, expect, it } from 'vitest';
import { parseSvg } from '../../io/svg/parse-svg';
import {
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type RasterImage,
  type SceneObject,
  type TextObject,
  type Vec2,
} from '../scene';
import { closedMaskContours, createImageMaskPixelTest } from './image-mask';
import { bakedImageMaskClip } from './image-mask-clip';

// Tools audit T1, T16-P2-1 and T16R-P2-1 (ADR-480 Amendment 6): the mask keeps
// the area Fill fills for the same object. Membership was even-odd over every
// contour of every path, so a non-zero path, unwelded text and separate
// overlapping paths lost the overlaps that Fill burns. The oracle here is an
// independent signed winding count per path, unioned over the paths.

// 20 x 20 mm image, 200 x 200 pixels: one pixel centre every 0.1 mm.
const IMAGE: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,photo',
  pixelWidth: 200,
  pixelHeight: 200,
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 10,
  imageMaskId: 'mask',
};

type Rule = 'nonzero' | 'evenodd';
type OraclePath = { readonly rule: Rule; readonly contours: ReadonlyArray<ReadonlyArray<Vec2>> };

function winding(point: Vec2, contours: ReadonlyArray<ReadonlyArray<Vec2>>): number {
  let total = 0;
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i += 1) {
      const a = contour[i]!;
      const b = contour[(i + 1) % contour.length]!;
      if (a.y > point.y === b.y > point.y) continue;
      const x = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (x > point.x) total += b.y > a.y ? 1 : -1;
    }
  }
  return total;
}

function oracleInside(point: Vec2, paths: ReadonlyArray<OraclePath>): boolean {
  return paths.some((path) => {
    const w = winding(point, path.contours);
    return path.rule === 'nonzero' ? w !== 0 : Math.abs(w) % 2 === 1;
  });
}

function distanceToEdges(point: Vec2, paths: ReadonlyArray<OraclePath>): number {
  let best = Infinity;
  for (const contour of paths.flatMap((path) => path.contours)) {
    for (let i = 0; i < contour.length; i += 1) {
      const a = contour[i]!;
      const b = contour[(i + 1) % contour.length]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)),
      );
      best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
    }
  }
  return best;
}

type Comparison = {
  readonly maskedMm2: number;
  readonly oracleMm2: number;
  readonly wrong: number;
};

// Pixel centres at least 2 um from every edge must agree with the oracle (the
// boolean engine resolves on a 1 um grid).
function compare(
  image: RasterImage,
  mask: SceneObject,
  paths: ReadonlyArray<OraclePath>,
): Comparison {
  const inside = createImageMaskPixelTest(image, mask, image.pixelWidth, image.pixelHeight);
  if (inside === null) throw new Error('Expected a mask.');
  const cell = 0.01;
  let masked = 0;
  let oracle = 0;
  let wrong = 0;
  for (let y = 0; y < image.pixelHeight; y += 1) {
    for (let x = 0; x < image.pixelWidth; x += 1) {
      const point = { x: (x + 0.5) * 0.1, y: (y + 0.5) * 0.1 };
      const got = inside(x, y);
      const want = oracleInside(point, paths);
      if (got) masked += cell;
      if (want) oracle += cell;
      if (got !== want && distanceToEdges(point, paths) > 0.002) wrong += 1;
    }
  }
  return { maskedMm2: masked, oracleMm2: oracle, wrong };
}

function pentagram(cx: number, cy: number, r: number): Vec2[] {
  return [0, 2, 4, 1, 3].map((k) => {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function rect(x: number, y: number, w: number, h: number): Vec2[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function svgObject(paths: ReadonlyArray<ColoredPath>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'mask',
    source: 'mask.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

const path = (contours: ReadonlyArray<ReadonlyArray<Vec2>>, fillRule?: Rule): ColoredPath => ({
  color: '#000000',
  ...(fillRule === undefined ? {} : { fillRule }),
  polylines: contours.map((points) => ({ points: [...points], closed: true })),
});

describe('the image mask keeps the region Fill fills (T16)', () => {
  it('reads a non-zero pentagram by winding, so its centre is kept', () => {
    const star = pentagram(10, 10, 8);
    const result = compare(IMAGE, svgObject([path([star], 'nonzero')]), [
      { rule: 'nonzero', contours: [star] },
    ]);
    // Main kept the even-odd region: the centre pentagon (about 22 mm2) stayed unburned.
    expect(result.wrong).toBe(0);
    expect(result.maskedMm2).toBeGreaterThan(70);
    expect(Math.abs(result.maskedMm2 - result.oracleMm2)).toBeLessThan(0.5);
  });

  it('keeps an even-odd pentagram (no fill rule) even-odd, contours untouched', () => {
    const star = pentagram(10, 10, 8);
    const mask = svgObject([path([star])]);
    expect(compare(IMAGE, mask, [{ rule: 'evenodd', contours: [star] }]).wrong).toBe(0);
    expect(closedMaskContours(mask)).toEqual([star]);
  });

  it('unions the overlapping glyph contours of unwelded text', () => {
    // Two same-wound contours that overlap in a 4 x 10 mm band, as script
    // joins do when Weld overlaps is off.
    const left = rect(2, 5, 10, 10);
    const right = rect(8, 5, 10, 10);
    const text: TextObject = {
      kind: 'text',
      id: 'mask',
      content: 'ab',
      fontKey: 'roboto',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: '#000000',
      bounds: { minX: 2, minY: 5, maxX: 18, maxY: 15 },
      transform: IDENTITY_TRANSFORM,
      paths: [path([left, right])],
    };
    const result = compare(IMAGE, text, [{ rule: 'nonzero', contours: [left, right] }]);
    // Main kept 120 mm2: the 40 mm2 overlap was knocked out of the photo.
    expect(result.wrong).toBe(0);
    expect(result.maskedMm2).toBeCloseTo(160, 0);
  });

  it('unions two overlapping even-odd paths of one imported SVG', () => {
    // The refuter's file: two overlapping 30 mm squares, each with its own
    // fill-rule, so the parser keeps them as two paths of one object.
    const parsed = parseSvg({
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40">' +
        '<path d="M5 5H35V35H5Z" style="fill:#000000;fill-rule:evenodd"/>' +
        '<path d="M25 5H55V35H25Z" style="fill:#000000;fill-rule:evenodd"/>' +
        '</svg>',
      id: 'mask',
      source: 'squares.svg',
    }).object;
    if (parsed === null) throw new Error('Expected parsed squares.');
    expect(parsed.paths).toHaveLength(2);
    const image: RasterImage = {
      ...IMAGE,
      pixelWidth: 600,
      pixelHeight: 400,
      bounds: { minX: 0, minY: 0, maxX: 60, maxY: 40 },
    };
    const oracle = parsed.paths.map((p) => ({
      rule: 'evenodd' as const,
      contours: p.polylines.map((polyline) =>
        polyline.points.map((point) => ({
          x: point.x * parsed.transform.scaleX + parsed.transform.x,
          y: point.y * parsed.transform.scaleY + parsed.transform.y,
        })),
      ),
    }));
    const result = compare(image, parsed, oracle);
    // Main kept 1200 mm2: the 300 mm2 overlap was XORed away.
    expect(result.wrong).toBe(0);
    expect(result.maskedMm2).toBeCloseTo(1500, 0);
  });

  it('keeps disjoint even-odd paths exactly as drawn, without a boolean pass', () => {
    const a = rect(1, 1, 4, 4);
    const b = rect(10, 10, 4, 4);
    expect(closedMaskContours(svgObject([path([a]), path([b])]))).toEqual([a, b]);
  });

  it('bakes the same region into the owned clip that Crop and Flatten store', () => {
    const star = pentagram(10, 10, 8);
    const mask = svgObject([path([star], 'nonzero')]);
    const clip = bakedImageMaskClip(IMAGE, mask);
    if (clip === null) throw new Error('Expected a baked clip.');
    const { imageMaskId: _mask, ...unmasked } = IMAGE;
    const baked: RasterImage = { ...unmasked, imageClip: clip };
    const result = compare(baked, mask, [{ rule: 'nonzero', contours: [star] }]);
    expect(result.wrong).toBe(0);
  });
});
