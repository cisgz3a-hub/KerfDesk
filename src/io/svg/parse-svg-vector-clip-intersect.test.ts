import { describe, expect, it } from 'vitest';
import type { ColoredPath, Vec2 } from '../../core/scene';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { parseSvgInWorker } from './parse-svg-worker';

// ADR-358 Amendment 2 (ART-2 follow-up to the 2026-09-25 audit): a clip that
// hides part of the artwork used to reject the whole file. The artwork now
// imports as the part its clip keeps. The document is 100 mm across with a
// 0..100 viewBox, so one user unit is one millimetre.

const SQUARE = '<path d="M10 10 H90 V90 H10 Z" fill="#ff0000"/>';
const LEFT_HALF = '<clipPath id="c"><rect width="50" height="100" fill="white"/></clipPath>';

function svg(defs: string, body: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    `width="100mm" height="100mm" viewBox="0 0 100 100"><defs>${defs}</defs>${body}</svg>`
  );
}

function parse(text: string): ParseSvgResult {
  return parseSvg({ svgText: text, id: 'O1', source: 'clipped.svg' });
}

function vectorPaths(result: ParseSvgResult): ColoredPath[] {
  return (result.fragment?.entries ?? []).flatMap((entry) =>
    entry.kind === 'imported-svg' ? entry.paths : [],
  );
}

function rounded(points: ReadonlyArray<Vec2>): number[][] {
  return points.map((point) => [point.x, point.y].map((value) => Math.round(value * 1000) / 1000));
}

function lines(result: ParseSvgResult): number[][][] {
  return vectorPaths(result).flatMap((path) => path.polylines.map((line) => rounded(line.points)));
}

// Clipper returns outlines and holes with opposite windings, so the signed
// sum is the filled area.
function filledArea(result: ParseSvgResult): number {
  let twice = 0;
  for (const line of vectorPaths(result).flatMap((path) => path.polylines)) {
    line.points.forEach((a, index) => {
      const b = line.points[(index + 1) % line.points.length] ?? a;
      twice += a.x * b.y - b.x * a.y;
    });
  }
  return Math.round(Math.abs(twice / 2) * 1000) / 1000;
}

function extent(result: ParseSvgResult): number[] {
  const points = vectorPaths(result).flatMap((path) =>
    path.polylines.flatMap((line) => line.points),
  );
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

describe('filled artwork a clip cuts', () => {
  it('imports the half a Figma-style frame clip keeps instead of rejecting the file', () => {
    const result = parse(svg(LEFT_HALF, `<g clip-path="url(#c)">${SQUARE}</g>`));
    expect(result.fragment?.entries).toHaveLength(1);
    expect(result.fragment?.entries[0]).toMatchObject({ operationOverride: { mode: 'fill' } });
    expect(extent(result)).toEqual([10, 10, 50, 90]);
    expect(filledArea(result)).toBe(40 * 80);
    expect(vectorPaths(result)[0]?.polylines.every((line) => line.closed)).toBe(true);
    // The legacy aggregate carries the same clipped outline.
    expect(result.object?.paths[0]?.polylines.map((line) => rounded(line.points))).toEqual(
      lines(result),
    );
  });

  it("intersects under the clip's even-odd rule, and SVG's nonzero default otherwise", () => {
    // Both rings wind the same way: even-odd leaves a hole, nonzero fills it.
    const rings = 'd="M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z"';
    const evenOdd = parse(
      svg(
        `<clipPath id="c"><path clip-rule="evenodd" ${rings}/></clipPath>`,
        `<g clip-path="url(#c)">${SQUARE}</g>`,
      ),
    );
    expect(filledArea(evenOdd)).toBe(80 * 80 - 50 * 50);
    const nonzero = parse(
      svg(`<clipPath id="c"><path ${rings}/></clipPath>`, `<g clip-path="url(#c)">${SQUARE}</g>`),
    );
    expect(filledArea(nonzero)).toBe(80 * 80);
    // clip-rule inherits through the clip definition, not from the artwork.
    const inherited = parse(
      svg(
        `<clipPath id="c" clip-rule="evenodd"><path ${rings}/></clipPath>`,
        `<g clip-rule="nonzero" clip-path="url(#c)">${SQUARE}</g>`,
      ),
    );
    expect(filledArea(inherited)).toBe(80 * 80 - 50 * 50);
  });

  it("keeps the clipped element's own fill rule", () => {
    const framed = (rule: string) =>
      parse(
        svg(
          LEFT_HALF,
          `<path clip-path="url(#c)" ${rule} d="M10 10 H90 V90 H10 Z M30 30 H70 V70 H30 Z"/>`,
        ),
      );
    expect(filledArea(framed('fill-rule="evenodd"'))).toBe(40 * 80 - 20 * 40);
    expect(filledArea(framed(''))).toBe(40 * 80);
  });

  it('imports nothing from artwork that lies wholly outside its clip', () => {
    const result = parse(
      svg(LEFT_HALF, '<path clip-path="url(#c)" d="M60 10 H90 V90 H60 Z"/>' + SQUARE),
    );
    expect(result.fragment?.entries).toHaveLength(1);
    expect(extent(result)).toEqual([10, 10, 90, 90]);
  });
});

describe('cut lines a clip trims', () => {
  const stroked = (d: string) =>
    parse(
      svg(LEFT_HALF, `<g clip-path="url(#c)"><path d="${d}" stroke="#0000ff" fill="none"/></g>`),
    );

  it('stops an open line at the clip edge and keeps its direction', () => {
    expect(lines(stroked('M-20 50 H120'))).toEqual([
      [
        [0, 50],
        [50, 50],
      ],
    ]);
    expect(lines(stroked('M120 50 H-20'))).toEqual([
      [
        [50, 50],
        [0, 50],
      ],
    ]);
    expect(stroked('M-20 50 H120').fragment?.entries[0]).toMatchObject({
      operationOverride: { mode: 'line' },
    });
  });

  it('keeps the pieces of a line that leaves and re-enters the clip in path order', () => {
    expect(lines(stroked('M10 10 L70 20 L10 30'))).toEqual([
      [
        [10, 10],
        [50, 16.667],
      ],
      [
        [50, 23.333],
        [10, 30],
      ],
    ]);
  });

  it('cuts a closed outline open at the clip edge as one piece from its start', () => {
    const result = parse(
      svg(
        LEFT_HALF,
        '<rect clip-path="url(#c)" x="40" y="10" width="20" height="20" stroke="#000" fill="none"/>',
      ),
    );
    expect(lines(result)).toEqual([
      [
        [50, 30],
        [40, 30],
        [40, 10],
        [50, 10],
      ],
    ]);
    expect(vectorPaths(result)[0]?.polylines[0]?.closed).toBe(false);
  });

  it('keeps lines lying on the clip outline, on every side', () => {
    // The last line crosses the clip, so the element is cut rather than kept whole.
    expect(lines(stroked('M50 10 V90 M0 10 V90 M10 0 H40 M10 100 H40 M40 60 H80'))).toEqual([
      [
        [50, 10],
        [50, 90],
      ],
      [
        [0, 10],
        [0, 90],
      ],
      [
        [10, 0],
        [40, 0],
      ],
      [
        [10, 100],
        [40, 100],
      ],
      [
        [40, 60],
        [50, 60],
      ],
    ]);
  });

  it('keeps the native curve of each line the clip leaves whole', () => {
    const result = stroked('M10 10 Q20 30 30 10 M40 50 H80');
    const curves = vectorPaths(result)[0]?.curves ?? [];
    expect(curves.map((curve) => curve.segments.map((segment) => segment.kind))).toEqual([
      ['cubic'],
      ['line'],
    ]);
    expect(lines(result)[1]).toEqual([
      [40, 50],
      [50, 50],
    ]);
  });
});

describe('clip coordinate systems', () => {
  const clipped = (clipPath: string, body = SQUARE, defs = '') =>
    parse(svg(clipPath + defs, `<g clip-path="url(#c)">${body}</g>`));

  it('maps objectBoundingBox units onto the bounding box of the clipped element', () => {
    const box =
      '<clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="0.5" height="1"/></clipPath>';
    expect(extent(parse(svg(box, `<path clip-path="url(#c)" d="M10 10 H90 V90 H10 Z"/>`)))).toEqual(
      [10, 10, 50, 90],
    );
    // A clipped group measures all of its rendered content.
    const group = parse(
      svg(
        box,
        '<g clip-path="url(#c)"><path d="M10 10 H40 V40 H10 Z"/><path d="M60 60 H90 V90 H60 Z"/></g>',
      ),
    );
    expect(extent(group)).toEqual([10, 10, 40, 40]);
  });

  it('applies the clipPath transform, the clip shape transform and the user space', () => {
    expect(
      extent(
        clipped(
          '<clipPath id="c" transform="translate(50 0)"><rect width="50" height="100"/></clipPath>',
        ),
      ),
    ).toEqual([50, 10, 90, 90]);
    expect(
      extent(
        clipped(
          '<clipPath id="c"><rect width="25" height="100" transform="scale(2 1)"/></clipPath>',
        ),
      ),
    ).toEqual([10, 10, 50, 90]);
    // userSpaceOnUse is the space of the element that references the clip.
    const moved = parse(
      svg(
        LEFT_HALF,
        '<g transform="translate(10 0)" clip-path="url(#c)"><path d="M0 10 H80 V90 H0 Z"/></g>',
      ),
    );
    expect(extent(moved)).toEqual([10, 10, 60, 90]);
  });

  it('reads a clip made of a <use> of a shape, as Illustrator exports clipping masks', () => {
    const result = parse(
      svg(
        '<rect id="SVGID_1_" width="50" height="100"/>',
        '<clipPath id="SVGID_2_"><use xlink:href="#SVGID_1_" style="overflow:visible;"/></clipPath>' +
          `<g style="clip-path:url(#SVGID_2_);">${SQUARE}</g>`,
      ),
    );
    expect(extent(result)).toEqual([10, 10, 50, 90]);
  });
});

describe('nested clips', () => {
  const TOP_HALF = '<clipPath id="top"><rect width="100" height="50"/></clipPath>';

  it.each([
    [
      'on the clipPath element',
      `<clipPath id="c" clip-path="url(#top)"><rect width="50" height="100"/></clipPath>`,
    ],
    [
      'on a clip child',
      `<clipPath id="c"><rect width="50" height="100" clip-path="url(#top)"/></clipPath>`,
    ],
  ])('intersects a clip-path %s', (_where, clipPath) => {
    const result = parse(svg(clipPath + TOP_HALF, `<g clip-path="url(#c)">${SQUARE}</g>`));
    expect(extent(result)).toEqual([10, 10, 50, 50]);
    expect(filledArea(result)).toBe(40 * 40);
  });

  it('intersects the clips of nested clipped groups', () => {
    const result = parse(
      svg(
        LEFT_HALF + TOP_HALF,
        `<g clip-path="url(#c)"><g clip-path="url(#top)">${SQUARE}</g></g>`,
      ),
    );
    expect(extent(result)).toEqual([10, 10, 50, 50]);
  });

  it('refuses clip paths nested inside themselves', () => {
    expect(() =>
      parse(
        svg(
          '<clipPath id="c" clip-path="url(#d)"><rect width="50" height="100"/></clipPath>' +
            '<clipPath id="d" clip-path="url(#c)"><rect width="100" height="50"/></clipPath>',
          `<g clip-path="url(#c)">${SQUARE}</g>`,
        ),
      ),
    ).toThrow(/nested inside itself/);
  });
});

describe('clipped import through the worker DOM', () => {
  it.each([
    ['a frame clip', svg(LEFT_HALF, `<g clip-path="url(#c)">${SQUARE}</g>`)],
    [
      'a <use> clip',
      svg(
        '<rect id="r" width="50" height="100"/><clipPath id="c"><use xlink:href="#r"/></clipPath>',
        `<g clip-path="url(#c)"><path d="M-20 50 H120" stroke="#000"/>${SQUARE}</g>`,
      ),
    ],
  ])('matches the main-thread parser for %s', (_name, text) => {
    const args = { svgText: text, id: 'O1', source: 'clipped.svg' };
    expect(parseSvgInWorker(args)).toEqual(parseSvg(args));
  });
});
