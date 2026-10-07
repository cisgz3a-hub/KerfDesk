import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { Bounds, ColoredPath, CurveSubpath } from '../../core/scene';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgWorkerDocument } from './parse-svg-worker';

// SVG 2 Units and Object bounding box units: percentages in primitive geometry
// use the nearest viewport's viewBox dimensions, including inside clip content.
// A clipPath does not establish a 1x1 percentage viewport for objectBoundingBox.
// https://www.w3.org/TR/SVG2/coords.html#Units
// https://www.w3.org/TR/SVG2/coords.html#ObjectBoundingBoxUnits
// Chrome 153 independently verifies the primitive, clip-definition and sized-use
// controls below. The clip percentages are deliberately small enough to separate
// definition space, target space, raw numeric prefixes and a hypothetical 1x1 box.

const identity = { id: 'percentage', source: 'percentage.svg' };
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

const svg = (body: string, attributes = 'viewBox="0 0 200 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;
const percentageRect = '<rect x="25%" y="25%" width="50%" height="50%"/>';
const numericRect = '<rect x="50" y="25" width="100" height="50"/>';
const diagonalRadius = (Math.hypot(200, 100) / Math.SQRT2) * 0.1;

function pathsOf(result: ParseSvgResult, color?: string): readonly ColoredPath[] {
  const paths = result.object?.paths ?? [];
  return color === undefined ? paths : paths.filter((path) => path.color === color);
}

function expectBounds(result: ParseSvgResult, expected: Bounds, color?: string): void {
  const points = pathsOf(result, color).flatMap((path) =>
    path.polylines.flatMap((line) => [...line.points]),
  );
  expect(points.length).toBeGreaterThan(0);
  const actual = {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
  for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const)
    expect(actual[key]).toBeCloseTo(expected[key], 3);
}

function firstCurve(result: ParseSvgResult): CurveSubpath {
  const curve = result.object?.paths[0]?.curves?.[0];
  if (curve === undefined) throw new Error('Expected canonical imported curve');
  return curve;
}

const aspects = [
  ['xMidYMid meet', { minX: 50, minY: 75, maxX: 150, maxY: 125 }],
  ['xMidYMid slice', { minX: 0, minY: 50, maxX: 200, maxY: 150 }],
  ['none', { minX: 50, minY: 50, maxX: 150, maxY: 150 }],
] as const;
const nestedAspects = [
  ['xMidYMid meet', { minX: 30, minY: 35, maxX: 70, maxY: 45 }],
  ['xMidYMid slice', { minX: 10, minY: 30, maxX: 90, maxY: 50 }],
  ['none', { minX: 30, minY: 30, maxX: 70, maxY: 50 }],
] as const;

describe.each(parsers)('SVG percentage geometry through %s', (_name, parse) => {
  it('resolves rect coordinates and sides on their respective viewport axes', async () => {
    expectBounds(await parse(svg(percentageRect)), { minX: 50, minY: 25, maxX: 150, maxY: 75 });
  });

  it('resolves both endpoints of a cut line on their respective axes', async () => {
    const result = await parse(svg('<line x1="25%" y1="10%" x2="75%" y2="90%" stroke="black"/>'));
    expect(result.object?.paths[0]?.polylines[0]?.points).toEqual([
      { x: 50, y: 10 },
      { x: 150, y: 90 },
    ]);
    expect(result.object?.paths[0]?.polylines[0]?.closed).toBe(false);
  });

  it('resolves circle radius on the normalized diagonal and retains its canonical curve', async () => {
    const result = await parse(svg('<circle cx="50%" cy="50%" r="10%"/>'));
    expectBounds(result, {
      minX: 100 - diagonalRadius,
      minY: 50 - diagonalRadius,
      maxX: 100 + diagonalRadius,
      maxY: 50 + diagonalRadius,
    });
    const curve = firstCurve(result);
    expect(curve.start.x).toBeCloseTo(100 + diagonalRadius, 10);
    expect(curve.start.y).toBe(50);
    // Fractional radii can split a quarter into two cubics in the existing arc
    // converter. The four geometric quarter endpoints and closure are stable.
    expect(curve.segments.length).toBeGreaterThanOrEqual(4);
    expect(curve.segments.every((segment) => segment.kind === 'cubic')).toBe(true);
    for (const endpoint of [
      { x: 100, y: 50 + diagonalRadius },
      { x: 100 - diagonalRadius, y: 50 },
      { x: 100, y: 50 - diagonalRadius },
      { x: 100 + diagonalRadius, y: 50 },
    ]) {
      expect(
        curve.segments.some(
          (segment) => Math.hypot(segment.to.x - endpoint.x, segment.to.y - endpoint.y) < 1e-10,
        ),
      ).toBe(true);
    }
    expect(curve.closed).toBe(true);
  });

  it('resolves ellipse centers and radii on width and height independently', async () => {
    const result = await parse(svg('<ellipse cx="25%" cy="75%" rx="10%" ry="10%"/>'));
    expectBounds(result, { minX: 30, minY: 65, maxX: 70, maxY: 85 });
    const curve = firstCurve(result);
    expect(curve.start).toEqual({ x: 70, y: 75 });
    expect(curve.segments).toHaveLength(4);
    expect(curve.segments[0]?.to).toEqual({ x: 50, y: 85 });
  });

  it('keeps rounded corners canonical after resolving each percentage radius', async () => {
    const result = await parse(
      svg('<rect x="10%" y="20%" width="50%" height="50%" rx="10%" ry="10%"/>'),
    );
    expectBounds(result, { minX: 20, minY: 20, maxX: 120, maxY: 70 });
    const curve = firstCurve(result);
    expect(curve.start).toEqual({ x: 40, y: 20 });
    expect(curve.segments.map((segment) => segment.kind)).toEqual([
      'line',
      'cubic',
      'line',
      'cubic',
      'line',
      'cubic',
      'line',
      'cubic',
    ]);
    expect(curve.segments[0]?.to).toEqual({ x: 100, y: 20 });
    expect(curve.segments[1]?.to).toEqual({ x: 120, y: 30 });
  });

  it('copies the resolved corner radius when the other radius is auto', async () => {
    const result = await parse(svg('<rect x="10%" y="20%" width="50%" height="50%" rx="10%"/>'));
    const curve = firstCurve(result);
    expect(curve.start).toEqual({ x: 40, y: 20 });
    expect(curve.segments[1]?.to).toEqual({ x: 120, y: 40 });
  });

  it('clamps resolved corner radii to each side and omits zero-length edges', async () => {
    const result = await parse(
      svg('<rect x="10%" y="20%" width="50%" height="50%" rx="50%" ry="50%"/>'),
    );
    const curve = firstCurve(result);
    expect(curve.start).toEqual({ x: 70, y: 20 });
    expect(curve.segments).toHaveLength(4);
    expect(curve.segments.every((segment) => segment.kind === 'cubic')).toBe(true);
    expect(curve.segments[0]?.to).toEqual({ x: 120, y: 45 });
  });

  it.each(aspects)('uses viewBox dimensions under root %s mapping', async (aspect, expected) => {
    const attributes = `width="200mm" height="200mm" viewBox="0 0 200 100" preserveAspectRatio="${aspect}" overflow="visible"`;
    expectBounds(await parse(svg(percentageRect, attributes)), expected);
  });

  it('does not add a nonzero viewBox origin to percentage coordinates', async () => {
    const attributes = 'width="200mm" height="100mm" viewBox="10 20 200 100"';
    expectBounds(await parse(svg(percentageRect, attributes)), {
      minX: 40,
      minY: 5,
      maxX: 140,
      maxY: 55,
    });
  });

  it.each(nestedAspects)('uses the nearest nested viewBox under %s', async (aspect, expected) => {
    const body = `<svg x="10" y="20" width="80" height="40" viewBox="0 0 40 10" preserveAspectRatio="${aspect}">${percentageRect}</svg>`;
    expectBounds(await parse(svg(body)), expected);
  });

  it('uses a nested viewport size when it has no viewBox', async () => {
    const body = `<svg x="10" y="20" width="80" height="40">${percentageRect}</svg>`;
    expectBounds(await parse(svg(body)), { minX: 30, minY: 30, maxX: 70, maxY: 50 });
  });

  it('does not treat a group transform as a new percentage viewport', async () => {
    const body =
      '<g transform="translate(10 20) scale(2 3)"><rect x="25%" y="10%" width="10%" height="20%"/></g>';
    expectBounds(await parse(svg(body)), { minX: 110, minY: 50, maxX: 150, maxY: 110 });
  });

  it.each(['width="192" height="96"', 'width="50.8mm" height="25.4mm"'])(
    'resolves no-viewBox percentages before the 96-DPI conversion: %s',
    async (attributes) => {
      const body = '<rect x="25%" y="50%" width="50%" height="25%"/>';
      expectBounds(await parse(svg(body, attributes)), {
        minX: 12.7,
        minY: 12.7,
        maxX: 38.1,
        maxY: 19.05,
      });
    },
  );

  it('accepts signed exponent percentages and retains negative placement', async () => {
    const body = '<rect x="-1.25e1%" y="+2.5e1%" width=" +2.5e1% " height="5e1%"/>';
    expectBounds(await parse(svg(body, 'viewBox="0 0 200 80"')), {
      minX: -25,
      minY: 20,
      maxX: 25,
      maxY: 60,
    });
  });

  it('resolves use x/y against the root viewport', async () => {
    const body =
      '<defs><rect id="tile" width="20" height="10"/></defs><use href="#tile" x="25%" y="50%"/>';
    expectBounds(await parse(svg(body)), { minX: 50, minY: 50, maxX: 70, maxY: 60 });
  });

  it('resolves use x/y against its nearest nested viewport', async () => {
    const body =
      '<defs><rect id="tile" width="20" height="10"/></defs><svg x="5" y="5" width="80" height="40"><use href="#tile" x="25%" y="50%"/></svg>';
    expectBounds(await parse(svg(body)), { minX: 25, minY: 25, maxX: 45, maxY: 35 });
  });

  it('keeps same-placement differently sized symbol geometry and object-box caches independent', async () => {
    const body =
      '<defs><clipPath id="half" clipPathUnits="objectBoundingBox"><rect width=".5" height="1"/></clipPath><symbol id="tile" overflow="visible"><rect x="25%" y="25%" width="50%" height="50%" clip-path="url(#half)"/></symbol></defs>' +
      '<use href="#tile" x="10" y="5" width="40" height="20" fill="#ff0000"/>' +
      '<use href="#tile" x="10" y="5" width="80" height="40" fill="#0000ff"/>';
    const result = await parse(svg(body));
    expectBounds(result, { minX: 20, minY: 10, maxX: 30, maxY: 20 }, '#ff0000');
    expectBounds(result, { minX: 30, minY: 15, maxX: 50, maxY: 35 }, '#0000ff');
  });

  it('retains symbol viewBox percentage dimensions across different use sizes', async () => {
    const body =
      '<defs><symbol id="tile" viewBox="0 0 40 20" overflow="visible"><ellipse cx="50%" cy="50%" rx="25%" ry="25%"/></symbol></defs>' +
      '<use href="#tile" width="40" height="20" fill="#ff0000"/>' +
      '<use href="#tile" x="100" y="50" width="80" height="40" fill="#0000ff"/>';
    const result = await parse(svg(body));
    expectBounds(result, { minX: 10, minY: 5, maxX: 30, maxY: 15 }, '#ff0000');
    expectBounds(result, { minX: 120, minY: 60, maxX: 160, maxY: 80 }, '#0000ff');
  });

  it.each(['shape', 'group'])(
    'measures percentage artwork before object-box clipping: %s',
    async (owner) => {
      const definition =
        '<defs><clipPath id="half" clipPathUnits="objectBoundingBox"><rect width=".5" height="1"/></clipPath></defs>';
      const artwork =
        owner === 'shape'
          ? '<rect x="25%" y="25%" width="50%" height="50%" clip-path="url(#half)"/>'
          : `<g clip-path="url(#half)">${percentageRect}</g>`;
      expectBounds(await parse(svg(definition + artwork)), {
        minX: 50,
        minY: 25,
        maxX: 100,
        maxY: 75,
      });
    },
  );

  it.each([
    ['userSpaceOnUse', '5%', '20%'],
    ['objectBoundingBox', '0.25%', '1%'],
  ])(
    'uses the clip definition viewport for %s percentage children',
    async (units, width, height) => {
      const body =
        `<defs><clipPath id="keep" clipPathUnits="${units}"><rect width="${width}" height="${height}"/></clipPath></defs>` +
        '<svg x="5" y="5" width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" clip-path="url(#keep)"/></svg>';
      expectBounds(await parse(svg(body)), { minX: 5, minY: 5, maxX: 15, maxY: 25 });
    },
  );

  it('uses a clip definition nested viewport even when its target is outside that viewport', async () => {
    const body =
      '<svg width="40" height="20" viewBox="0 0 40 20" overflow="visible"><defs><clipPath id="keep"><rect x="10%" y="25%" width="50%" height="50%"/></clipPath></defs></svg>' +
      '<rect width="100" height="50" clip-path="url(#keep)"/>';
    expectBounds(await parse(svg(body)), { minX: 4, minY: 5, maxX: 24, maxY: 15 });
  });

  it('resolves use offsets inside a clip definition', async () => {
    const body =
      '<defs><rect id="tile" width="50" height="30"/><clipPath id="keep"><use href="#tile" x="25%" y="25%"/></clipPath></defs>' +
      '<rect width="200" height="100" clip-path="url(#keep)"/>';
    expectBounds(await parse(svg(body)), { minX: 50, minY: 25, maxX: 100, maxY: 55 });
  });

  it('resolves diagonal percentages in curved clip content through the region engine', async () => {
    const body =
      '<defs><clipPath id="keep"><circle cx="50%" cy="50%" r="10%"/></clipPath></defs>' +
      '<rect width="200" height="100" clip-path="url(#keep)"/>';
    expectBounds(await parse(svg(body)), {
      minX: 100 - diagonalRadius,
      minY: 50 - diagonalRadius,
      maxX: 100 + diagonalRadius,
      maxY: 50 + diagonalRadius,
    });
  });

  it('clips cut-line stretches against percentage clip geometry', async () => {
    const body =
      '<defs><clipPath id="keep"><rect width="50%" height="100%"/></clipPath></defs>' +
      '<line x1="0" y1="50" x2="200" y2="50" stroke="black" clip-path="url(#keep)"/>';
    expect(resultPoints(await parse(svg(body)))).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
  });

  it('preserves a canonical curve wholly contained by a percentage clip', async () => {
    const curve = '<path d="M60 20C65 80 80 80 90 20" fill="none" stroke="black"/>';
    const body =
      '<defs><clipPath id="keep"><rect width="50%" height="100%"/></clipPath></defs>' +
      `<g clip-path="url(#keep)">${curve}</g>`;
    const result = await parse(svg(body));
    expect(result.object?.paths).toEqual((await parse(svg(curve))).object?.paths);
    expect(firstCurve(result).segments[0]?.kind).toBe('cubic');
  });

  it('numeric control: ordinary coordinates remain unchanged', async () => {
    expectBounds(await parse(svg(numericRect)), { minX: 50, minY: 25, maxX: 150, maxY: 75 });
  });

  it('numeric control: no-viewBox coordinates retain the 96-DPI conversion', async () => {
    expectBounds(
      await parse(svg('<rect x="48" y="48" width="96" height="24"/>', 'width="192" height="96"')),
      {
        minX: 12.7,
        minY: 12.7,
        maxX: 38.1,
        maxY: 19.05,
      },
    );
  });

  it('absolute-unit control: shape lengths remain CSS user units before mapping', async () => {
    const body = '<rect x=".5in" y="6pt" width="2.54cm" height="1pc"/>';
    expectBounds(await parse(svg(body, 'width="192" height="96"')), {
      minX: 12.7,
      minY: 25.4 / 12,
      maxX: 38.1,
      maxY: 6.35,
    });
  });

  it.each(nestedAspects)(
    'viewport control: numeric children retain nested %s mapping',
    async (aspect, expected) => {
      const body = `<svg x="10" y="20" width="80" height="40" viewBox="0 0 40 10" preserveAspectRatio="${aspect}"><rect x="10" y="2.5" width="20" height="5"/></svg>`;
      expectBounds(await parse(svg(body)), expected);
    },
  );

  it('object-box control: ordinary fractional clip coordinates still keep half', async () => {
    const body =
      '<defs><clipPath id="keep" clipPathUnits="objectBoundingBox"><rect width=".5" height="1"/></clipPath></defs>' +
      '<svg x="5" y="5" width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" clip-path="url(#keep)"/></svg>';
    expectBounds(await parse(svg(body)), { minX: 5, minY: 5, maxX: 15, maxY: 25 });
  });

  it.each(['userSpaceOnUse', 'objectBoundingBox'])(
    'definition-viewport control: a large %s percentage clip keeps the complete target',
    async (units) => {
      const body =
        `<defs><clipPath id="keep" clipPathUnits="${units}"><rect width="50%" height="100%"/></clipPath></defs>` +
        '<svg x="5" y="5" width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" clip-path="url(#keep)"/></svg>';
      expectBounds(await parse(svg(body)), { minX: 5, minY: 5, maxX: 25, maxY: 25 });
    },
  );

  it('zero/negative-size control: percentages cannot create disabled primitive geometry', async () => {
    const body = '<rect width="0%" height="50%"/><circle r="0%"/><ellipse rx="-10%" ry="10%"/>';
    const result = await parse(svg(body));
    expect(result.object).toBeNull();
    expect(result.fragment?.entries).toEqual([]);
  });

  it('CSS-geometry boundary: declared primitive attributes remain the supported source', async () => {
    const body =
      '<rect x="1" y="2" width="10" height="20" style="x:25%;y:25%;width:50%;height:50%"/>';
    expectBounds(await parse(svg(body)), { minX: 1, minY: 2, maxX: 11, maxY: 22 });
  });

  it('image-percentage boundary: unsupported image dimensions remain disclosed omissions', async () => {
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLSsAAAAASUVORK5CYII=';
    const result = await parse(svg(`<image href="${pixel}" width="50%" height="50%"/>`));
    expect(result.object).toBeNull();
    expect(result.fragment?.entries).toEqual([]);
    expect(result.notes.length).toBeGreaterThan(0);
  });
});

function resultPoints(result: ParseSvgResult) {
  return result.object?.paths[0]?.polylines[0]?.points;
}
