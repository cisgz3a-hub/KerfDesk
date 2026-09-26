import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  type ColoredPath,
  type Vec2,
} from '../../core/scene';
import { parseSvg, type ParseSvgResult } from './parse-svg';

// ADR-358 Amendment 2 (ART-2 follow-up): masks and filters import without
// their effect and say so; clips KerfDesk cannot read refuse with their
// reason; cut curves keep machine precision; image clips accept SVG's
// defaults.

const SQUARE = '<path d="M10 10 H90 V90 H10 Z" fill="#ff0000"/>';
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLSsAAAAASUVORK5CYII=';

function svg(defs: string, body: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    `width="100mm" height="100mm" viewBox="0 0 100 100"><defs>${defs}</defs>${body}</svg>`
  );
}

function parse(text: string): ParseSvgResult {
  return parseSvg({ svgText: text, id: 'O1', source: 'effects.svg' });
}

function vectorPaths(result: ParseSvgResult): ColoredPath[] {
  return (result.fragment?.entries ?? []).flatMap((entry) =>
    entry.kind === 'imported-svg' ? entry.paths : [],
  );
}

describe('vector masks and filters', () => {
  it('imports masked artwork unmasked, with a warning', () => {
    const result = parse(
      svg(
        '<mask id="m"><rect width="50" height="100" fill="white"/></mask>',
        `<g mask="url(#m)">${SQUARE}</g>`,
      ),
    );
    expect(vectorPaths(result)[0]?.polylines).toHaveLength(1);
    expect(result.notes).toEqual([
      'SVG presentation: Imported 1 SVG element(s) without their masks; areas the masks hide are included.',
    ]);
  });

  it('imports filtered artwork unfiltered, with a warning', () => {
    const result = parse(svg('', `<g style="filter:url(#blur)">${SQUARE}${SQUARE}</g>`));
    expect(result.fragment?.entries).toHaveLength(1);
    expect(result.notes).toEqual([
      'SVG presentation: Imported 2 SVG element(s) without their filter effects.',
    ]);
  });

  it('does not disclose an effect on artwork a clip removes entirely', () => {
    const result = parse(
      svg(
        '<clipPath id="c"><rect width="5" height="5"/></clipPath>',
        `<g clip-path="url(#c)" mask="url(#m)">${SQUARE}</g>`,
      ),
    );
    expect(result.fragment?.entries).toEqual([]);
    expect(result.notes).toEqual(['SVG has no drawable geometry']);
  });
});

describe('clips that cannot be imported faithfully', () => {
  const clipped = (defs: string) => () => parse(svg(defs, `<g clip-path="url(#c)">${SQUARE}</g>`));

  it('refuses a clip made of text, which KerfDesk cannot outline', () => {
    expect(clipped('<clipPath id="c"><text x="10" y="50">KerfDesk</text></clipPath>')).toThrow(
      /clip paths made of text are not supported/,
    );
    expect(
      clipped(
        '<text id="t" x="10" y="50">KerfDesk</text><clipPath id="c"><use href="#t"/></clipPath>',
      ),
    ).toThrow(/clip paths made of text are not supported/);
    // Hidden text contributes nothing, so it does not block the import.
    expect(
      clipped(
        '<clipPath id="c"><rect width="50" height="100"/><text display="none">KerfDesk</text></clipPath>',
      ),
    ).not.toThrow();
  });

  it('refuses a clip <use> that refers to anything but a shape', () => {
    expect(
      clipped(
        '<g id="g"><rect width="50" height="100"/></g><clipPath id="c"><use href="#g"/></clipPath>',
      ),
    ).toThrow(/must refer directly to a shape or path/);
  });

  it('refuses a clip-path that refers to no clipPath', () => {
    expect(clipped('<rect id="c" width="50" height="100"/>')).toThrow(/not a clipPath/);
    expect(clipped('')).toThrow(/#c, which is not a clipPath/);
  });

  it('refuses clips whose nested references multiply beyond any real artwork', () => {
    // Ten children at each of four levels each name the next clip: 10^4 clips.
    const level = (id: string, next: string) =>
      `<clipPath id="${id}">${`<rect width="50" height="100" clip-path="url(#${next})"/>`.repeat(10)}</clipPath>`;
    const nest =
      level('c', 'd1') +
      level('d1', 'd2') +
      level('d2', 'd3') +
      level('d3', 'd4') +
      '<clipPath id="d4"><rect width="50" height="100"/></clipPath>';
    expect(clipped(nest)).toThrow(/refer to one another too many times/);
  });
});

describe('curve precision under a clip', () => {
  it('cuts a clipped curve along the path job compilation cuts for the whole curve', () => {
    // A 30 mm circle drawn with arcs, cut in half by the frame.
    const d = 'M20 50 A30 30 0 1 1 80 50 A30 30 0 1 1 20 50 Z';
    const whole = vectorPaths(parse(svg('', `<path d="${d}"/>`)))[0];
    const machine = flattenCurveSubpath(
      whole?.curves?.[0] ?? { start: { x: 0, y: 0 }, segments: [], closed: true },
      {
        toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
      },
    );
    const leftOfCut = (points: ReadonlyArray<Vec2>) => points.filter((point) => point.x < 49.999);
    const cut = leftOfCut(machine.kind === 'ok' ? machine.polyline.points : []);
    const half = parse(
      svg(
        '<clipPath id="c"><rect width="50" height="100"/></clipPath>',
        `<path clip-path="url(#c)" d="${d}"/>`,
      ),
    );
    const arc = leftOfCut(vectorPaths(half)[0]?.polylines[0]?.points ?? []);
    const near = (point: Vec2, among: ReadonlyArray<Vec2>) =>
      among.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < 1e-3);
    // Same vertices, to the 1 µm clip grid, in both directions.
    expect(arc.every((point) => near(point, cut))).toBe(true);
    expect(cut.every((point) => near(point, arc))).toBe(true);
    // The 0.25 mm display samples of the same half are far coarser.
    expect(arc.length).toBeGreaterThan(2 * leftOfCut(whole?.polylines[0]?.points ?? []).length);
  });

  it('keeps the native curves of filled artwork a concave clip keeps whole', () => {
    const result = parse(
      svg(
        '<clipPath id="c"><path d="M0 0 H100 V50 H50 V100 H0 Z"/></clipPath>',
        '<path clip-path="url(#c)" d="M10 10 C20 0 30 0 40 10 L40 40 L10 40 Z"/>',
      ),
    );
    const curve = vectorPaths(result)[0]?.curves?.[0];
    expect(curve?.segments.map((segment) => segment.kind)).toEqual([
      'cubic',
      'line',
      'line',
      'line',
    ]);
  });
});

describe('image clips read SVG defaults', () => {
  const image = (clipPath: string) =>
    parse(
      svg(
        clipPath,
        `<image clip-path="url(#crop)" width="4" height="4" preserveAspectRatio="none" href="${PIXEL}"/>`,
      ),
    ).fragment?.entries[0];

  it("reads a missing clip-rule as SVG's nonzero default", () => {
    // Same-direction rings: nonzero keeps the middle, even-odd would cut it out.
    const entry = image('<clipPath id="crop"><path d="M0 0H4V4H0Z M1 1H3V3H1Z"/></clipPath>');
    expect(entry).toMatchObject({ kind: 'svg-image', imageClip: [{ fillRule: 'evenodd' }] });
    const rings = entry?.kind === 'svg-image' ? (entry.imageClip?.[0]?.polylines ?? []) : [];
    expect(rings).toHaveLength(1);
    expect(rings[0]?.points.map((point) => [point.x, point.y]).sort()).toEqual([
      [0, 0],
      [0, 4],
      [4, 0],
      [4, 4],
    ]);
  });

  it('accepts a clip made of a basic shape', () => {
    const entry = image('<clipPath id="crop"><rect x="1" width="2" height="4"/></clipPath>');
    const rings = entry?.kind === 'svg-image' ? (entry.imageClip?.[0]?.polylines ?? []) : [];
    expect(rings.flatMap((ring) => ring.points.map((point) => point.x)).sort()).toEqual([
      1, 1, 3, 3,
    ]);
  });
});
