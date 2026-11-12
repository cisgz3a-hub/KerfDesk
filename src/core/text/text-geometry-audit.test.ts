import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { curveSubpathBounds } from '../scene';
import { textToPolylines, type TextRenderResult } from './text-to-polylines';
import { bendTextUndistorted, styledBentRender } from './text-style';
import { placeTextOnPath } from './text-on-path';
import { createRectangle } from '../shapes/primitives/create-rectangle';

function render(content: string, font = 'Roboto-Regular.ttf') {
  const bytes = readFileSync(resolve('src/ui/text/fonts', font));
  const fontBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return textToPolylines({
    fontBuffer,
    content,
    sizeMm: 20,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#000000',
  });
}

function coordinates(rendered: TextRenderResult) {
  return rendered.paths
    .flatMap((path) =>
      path.polylines.flatMap((line) =>
        line.points.map((point) => `${point.x.toFixed(8)},${point.y.toFixed(8)}`),
      ),
    )
    .sort();
}

it.each(['Roboto-Regular.ttf', 'Tinos-Regular.ttf'])(
  'bends natural kerned letters independently in %s',
  async (font) => {
    for (const content of ['AV', 'To', 'AV\nTo']) {
      const plain = await render(content, font);
      const bent = bendTextUndistorted(plain, 120);
      expect(coordinates(bent)).not.toEqual(coordinates(plain));
      // Every contour stays rigid: all pairwise curve-anchor distances survive.
      const before = plain.paths[0]!.curves!;
      const after = bent.paths[0]!.curves!;
      expect(after).toHaveLength(before.length);
      before.forEach((curve, index) => {
        const source = [curve.start, ...curve.segments.map((segment) => segment.to)];
        const target = [
          after[index]!.start,
          ...after[index]!.segments.map((segment) => segment.to),
        ];
        source.forEach((point, anchor) => {
          expect(
            Math.hypot(target[anchor]!.x - target[0]!.x, target[anchor]!.y - target[0]!.y),
          ).toBeCloseTo(Math.hypot(point.x - source[0]!.x, point.y - source[0]!.y), 8);
        });
      });
    }
  },
);

it('keeps glyph identity through bold, italic and squeeze before a rigid bend', async () => {
  const plain = await render('AV');
  const styled = {
    textStyle: { bold: true, italic: true, maxWidthMm: 20, bendUndistorted: true },
    sizeMm: 20,
  };
  expect(coordinates(styledBentRender(plain, { ...styled, bendDeg: 120 }))).not.toEqual(
    coordinates(styledBentRender(plain, styled)),
  );
});

it('retains the first glyph edge when reversing a closed guide with a repeated endpoint', async () => {
  const rendered = await render('H');
  // The first glyph's left edge alone, as one open polyline: path text splits
  // edges that run along the guide (O7-P2-2), and this edge runs across it, so
  // its points keep their indices.
  const stem = rendered.paths[0]!.polylines[0]!.points.filter(
    (point) => Math.abs(point.x - rendered.bounds.minX) < 1e-9,
  );
  const text = {
    ...rendered,
    paths: [
      {
        ...rendered.paths[0]!,
        polylines: [{ closed: false, points: stem }, ...rendered.paths[0]!.polylines.slice(1)],
      },
    ],
  };
  const guide = createRectangle({
    id: 'guide',
    color: '#000000',
    spec: { widthMm: 100, heightMm: 80, cornerRadiusMm: 0 },
  });
  const settings = { guideObjectId: guide.id, offsetMm: 0, reverse: true };
  const placed = placeTextOnPath(text, guide, settings);
  if (placed.kind !== 'ok') throw new Error(placed.kind);
  const positions = text.paths[0]!.polylines[0]!.points.flatMap((point, index) =>
    Math.abs(point.x - text.bounds.minX) < 1e-9 ? [index] : [],
  );
  const transformed = positions.map(
    (index) => placed.rendered.paths[0]!.polylines[0]!.points[index]!,
  );
  expect(transformed.length).toBeGreaterThanOrEqual(2);
  const span = Math.max(
    ...transformed.flatMap((a) => transformed.map((b) => Math.hypot(a.x - b.x, a.y - b.y))),
  );
  expect(span).toBeCloseTo(text.bounds.maxY - text.bounds.minY, 8);
  expect(curveSubpathBounds(placed.rendered.paths[0]!.curves![0]!).maxY).toBeGreaterThan(0);
});
