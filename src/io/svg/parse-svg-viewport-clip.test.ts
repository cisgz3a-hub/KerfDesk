import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgWorkerDocument } from './parse-svg-worker';

const identity = { id: 'viewport-clip', source: 'viewport-clip.svg' };
const svg = (content: string, width = 100) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${width}mm" height="100mm">${content}</svg>`;
const overflowing = '<rect width="80" height="10" fill="black"/>';
const nested = (attributes: string, content = overflowing) =>
  `<svg x="10" y="10" width="20" height="20" ${attributes}>${content}</svg>`;

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

const rounded = (value: number) => Math.round(value * 1000) / 1000;
function pathBounds(paths: readonly ColoredPath[]) {
  const points = paths.flatMap((path) => path.polylines.flatMap((line) => [...line.points]));
  return {
    minX: rounded(Math.min(...points.map((point) => point.x))),
    minY: rounded(Math.min(...points.map((point) => point.y))),
    maxX: rounded(Math.max(...points.map((point) => point.x))),
    maxY: rounded(Math.max(...points.map((point) => point.y))),
  };
}
const bounds = (result: ParseSvgResult) => pathBounds(result.object?.paths ?? []);

describe.each(parsers)('SVG viewport clipping through %s', (_name, parse) => {
  it.each(['hidden', 'scroll'])(
    'clips explicit %s root overflow to its physical viewport under slice',
    async (overflow) => {
      const result = await parse(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="10 20 100 100"' +
          ` preserveAspectRatio="xMidYMid slice" overflow="${overflow}">` +
          '<rect x="10" y="20" width="100" height="100"/></svg>',
      );
      expect(bounds(result)).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 });
    },
  );

  it('keeps the viewBox-only origin when clipping explicit root overflow', async () => {
    const result = await parse(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 100" overflow="hidden">' +
        '<rect width="200" height="200"/></svg>',
    );
    expect(bounds(result)).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 120 });
  });

  it.each(['', 'overflow="hidden"', 'overflow="scroll"', 'style="overflow: hidden"'])(
    'keeps only the visible fill for a nested viewport with %s',
    async (attributes) => {
      const result = await parse(svg(nested(attributes)));
      expect(bounds(result)).toEqual({ minX: 10, minY: 10, maxX: 30, maxY: 20 });
      expect(result.fragment?.entries).toHaveLength(1);
      expect(result.notes).toEqual([]);
    },
  );

  it.each(['visible', 'auto', 'initial', 'unset'])(
    'lets %s overflow render outside the nested viewport',
    async (overflow) => {
      const result = await parse(svg(nested(`overflow="${overflow}"`)));
      expect(bounds(result)).toEqual({ minX: 10, minY: 10, maxX: 90, maxY: 20 });
    },
  );

  it('resolves stylesheet overflow and importance ahead of the attribute and inline style', async () => {
    const result = await parse(
      svg(
        '<style>.viewport { overflow: visible } #crop { overflow: hidden !important }</style>' +
          nested('id="crop" class="viewport" overflow="visible" style="overflow: visible"'),
      ),
    );
    expect(bounds(result)).toEqual({ minX: 10, minY: 10, maxX: 30, maxY: 20 });
  });

  it('allows a stylesheet to override hidden overflow with visible', async () => {
    const result = await parse(
      svg(
        '<style>.viewport { overflow: visible }</style>' +
          nested('class="viewport" overflow="hidden"'),
      ),
    );
    expect(bounds(result)).toEqual({ minX: 10, minY: 10, maxX: 90, maxY: 20 });
  });

  it('inherits overflow only when requested', async () => {
    const result = await parse(svg(`<g overflow="hidden">${nested('overflow="inherit"')}</g>`));
    expect(bounds(result)).toEqual({ minX: 10, minY: 10, maxX: 30, maxY: 20 });
    const initial = await parse(svg(`<g overflow="hidden">${nested('overflow="unset"')}</g>`));
    expect(bounds(initial)).toEqual({ minX: 10, minY: 10, maxX: 90, maxY: 20 });
  });

  it('clips a sliced symbol to the use viewport instead of the viewBox', async () => {
    const result = await parse(
      svg(
        '<defs><symbol id="icon" viewBox="0 0 10 20" preserveAspectRatio="xMidYMid slice">' +
          '<rect width="10" height="20"/></symbol></defs>' +
          '<use href="#icon" x="10" y="10" width="40" height="40"/>',
      ),
    );
    expect(bounds(result)).toEqual({ minX: 10, minY: 10, maxX: 50, maxY: 50 });
  });

  it('lets a symbol explicitly render visible overflow', async () => {
    const result = await parse(
      svg(
        '<defs><symbol id="icon" viewBox="0 0 10 20" preserveAspectRatio="xMidYMid slice" overflow="visible">' +
          '<rect width="10" height="20"/></symbol></defs>' +
          '<use href="#icon" x="10" y="10" width="40" height="40"/>',
      ),
    );
    expect(bounds(result)).toEqual({ minX: 10, minY: -10, maxX: 50, maxY: 70 });
  });

  it('uses the overridden use size when clipping a referenced svg', async () => {
    const result = await parse(
      svg(
        '<defs><svg id="box" width="10" height="10" viewBox="0 0 1 1">' +
          '<rect width="4" height="1"/></svg></defs>' +
          '<use href="#box" x="10" y="10" width="30" height="20"/>',
      ),
    );
    expect(bounds(result)).toEqual({ minX: 15, minY: 10, maxX: 40, maxY: 30 });
  });

  it('keeps separate clip rectangles for differently placed instances', async () => {
    const result = await parse(
      svg(
        '<defs><symbol id="box" viewBox="0 0 10 10" preserveAspectRatio="none">' +
          overflowing +
          '</symbol></defs>' +
          '<use href="#box" width="20" height="20"/>' +
          '<use href="#box" x="50" width="30" height="20"/>',
      ),
    );
    const ranges = result.object?.paths[0]?.polylines.map((line) =>
      pathBounds([{ color: '#000000', polylines: [line] }]),
    );
    expect(ranges).toEqual([
      { minX: 0, minY: 0, maxX: 20, maxY: 20 },
      { minX: 50, minY: 0, maxX: 80, maxY: 20 },
    ]);
  });

  it('places a transformed viewport in parent space under a letterboxed root', async () => {
    const result = await parse(
      svg(
        '<g transform="translate(30 20)">' +
          '<svg x="5" y="7" width="20" height="10" viewBox="0 0 10 10" preserveAspectRatio="none"' +
          ' transform="matrix(1 0.5 -0.25 1 0 0)">' +
          '<rect x="-20" y="-20" width="50" height="50"/></svg></g>',
        200,
      ),
    );
    const points = result.object?.paths[0]?.polylines[0]?.points.map(
      (point) => `${rounded(point.x)},${rounded(point.y)}`,
    );
    expect(new Set(points)).toEqual(
      new Set(['83.25,29.5', '103.25,39.5', '100.75,49.5', '80.75,39.5']),
    );
  });

  it('intersects outer and inner viewports with an explicit clip path', async () => {
    const result = await parse(
      svg(
        '<defs><clipPath id="crop"><rect width="3" height="50"/></clipPath></defs>' +
          '<svg x="10" y="10" width="20" height="20">' +
          '<svg x="15" y="5" width="20" height="20">' +
          '<rect width="80" height="80" clip-path="url(#crop)"/></svg></svg>',
      ),
    );
    expect(bounds(result)).toEqual({ minX: 25, minY: 15, maxX: 28, maxY: 30 });
  });

  it('resolves a viewport-owned user-space clip after its viewBox mapping', async () => {
    // Chrome paints 10..20 by 10..30: the 5-unit clip scales by 2, then
    // intersects the 20-unit viewport. It is not a clip at the root's 0..5.
    const result = await parse(
      svg(
        '<defs><clipPath id="crop"><rect width="5" height="10"/></clipPath></defs>' +
          '<svg x="10" y="10" width="20" height="20" viewBox="0 0 10 10" clip-path="url(#crop)">' +
          '<rect width="20" height="20"/></svg>',
      ),
    );
    expect(bounds(result)).toEqual({ minX: 10, minY: 10, maxX: 20, maxY: 30 });
  });

  it('measures a viewport-owned object bounding box before viewport clipping', async () => {
    // This pins SVG 2's viewport intersection. Chrome 153 paints 20..40 by
    // 10..50 here, dropping the same element's implicit overflow clip.
    const result = await parse(
      svg(
        '<defs><clipPath id="crop" clipPathUnits="objectBoundingBox">' +
          '<rect x="0.25" width="0.5" height="1"/></clipPath></defs>' +
          '<svg x="10" y="10" width="20" height="20" viewBox="0 0 10 10" clip-path="url(#crop)">' +
          '<rect width="20" height="20"/></svg>',
      ),
    );
    // The full 20-unit shape has a bbox clip at 5..15, mapping to 20..40.
    // Its viewport keeps 20..30. Measuring the clipped bbox would keep 15..25.
    expect(bounds(result)).toEqual({ minX: 20, minY: 10, maxX: 30, maxY: 30 });
  });

  it('uses the instance content space for symbol-owned clips', async () => {
    // Content placement matches Chrome 153, while the exact viewport
    // intersection is the SVG 2 rule; Chrome lets this own clip overflow.
    const result = await parse(
      svg(
        '<defs><clipPath id="crop"><rect width="5" height="20"/></clipPath>' +
          '<symbol id="icon" viewBox="0 0 10 20" preserveAspectRatio="xMidYMid slice" clip-path="url(#crop)">' +
          '<rect width="10" height="20"/></symbol></defs>' +
          '<use href="#icon" x="10" y="10" width="40" height="40"/>',
      ),
    );
    expect(bounds(result)).toEqual({ minX: 10, minY: 10, maxX: 30, maxY: 50 });
  });

  it('keeps object-box clips independent of the referenced svg definition size', async () => {
    const result = await parse(
      svg(
        '<defs><clipPath id="crop" clipPathUnits="objectBoundingBox">' +
          '<rect x="0.125" width="0.125" height="1"/></clipPath>' +
          '<svg id="box" width="10" height="10" viewBox="0 0 1 1" clip-path="url(#crop)">' +
          '<rect width="4" height="1"/></svg></defs>' +
          '<use href="#box" x="10" y="10" width="30" height="20"/>' +
          '<use href="#box" x="60" y="10" width="30" height="40"/>',
      ),
    );
    const ranges = result.object?.paths[0]?.polylines.map((line) =>
      pathBounds([{ color: '#000000', polylines: [line] }]),
    );
    expect(ranges).toEqual([
      { minX: 25, minY: 10, maxX: 35, maxY: 30 },
      { minX: 75, minY: 15, maxX: 90, maxY: 45 },
    ]);
  });

  it('does not let visible child overflow remove an ancestor viewport clip', async () => {
    const result = await parse(
      svg(
        '<svg x="10" y="10" width="20" height="20">' +
          '<svg x="15" y="5" width="20" height="20" overflow="visible">' +
          '<rect width="80" height="80"/></svg></svg>',
      ),
    );
    expect(bounds(result)).toEqual({ minX: 25, minY: 15, maxX: 30, maxY: 30 });
  });

  it('imports no vector geometry wholly outside the viewport', async () => {
    const result = await parse(svg(nested('', '<rect x="30" y="30" width="5" height="5"/>')));
    expect(result.object).toBeNull();
    expect(result.fragment?.entries).toEqual([]);
  });

  it('keeps an edge line and clips it to the viewport width', async () => {
    const result = await parse(svg(nested('', '<path d="M-5 0H25" fill="none" stroke="black"/>')));
    expect(bounds(result)).toEqual({ minX: 10, minY: 10, maxX: 30, maxY: 10 });
    expect(result.object?.paths[0]?.polylines[0]?.closed).toBe(false);
  });

  it('preserves fully contained native curves without flattening', async () => {
    const body = '<path d="M2 2 C4 12 14 12 18 2" fill="none" stroke="black"/>';
    const clipped = await parse(svg(nested('', body)));
    const visible = await parse(svg(nested('overflow="visible"', body)));
    expect(clipped.fragment).toEqual(visible.fragment);
    expect(clipped.object?.paths[0]?.curves?.[0]?.segments[0]?.kind).toBe('cubic');
  });

  it('clips a crossing curve and retains only its kept line stretches', async () => {
    const result = await parse(
      svg(nested('', '<path d="M-5 10 C5 0 15 20 25 10" fill="none" stroke="black"/>')),
    );
    expect(bounds(result)).toMatchObject({ minX: 10, maxX: 30 });
    expect(
      result.object?.paths[0]?.curves
        ?.flatMap((curve) => curve.segments)
        .every((segment) => segment.kind === 'line'),
    ).toBe(true);
  });

  it('owns transformed image clipping in image coordinates without adding vector artwork', async () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLSsAAAAASUVORK5CYII=';
    const result = await parse(
      svg(
        '<defs><clipPath id="crop"><rect x="2" y="1" width="6" height="20"/></clipPath></defs>' +
          '<g transform="translate(40 20)">' +
          '<svg x="10" y="5" width="20" height="10" viewBox="0 0 10 10" preserveAspectRatio="none" transform="rotate(90)">' +
          `<image x="-5" y="-5" width="20" height="20" preserveAspectRatio="none" href="${png}" clip-path="url(#crop)"/>` +
          '</svg></g>',
      ),
    );
    expect(result.object).toBeNull();
    expect(result.fragment?.entries).toHaveLength(1);
    const image = result.fragment?.entries[0];
    if (image?.kind !== 'svg-image') throw new Error('Expected embedded image');
    expect(pathBounds(image.imageClip ?? [])).toEqual({ minX: 2, minY: 1, maxX: 8, maxY: 10 });
    expect(image.transform).toMatchObject({ x: 35, y: 30, rotationDeg: 90, scaleX: 2, scaleY: 1 });
    expect(result.ignoredImageElements).toBe(0);
    expect(result.notes).toEqual([]);
  });
});
