import { describe, expect, it } from 'vitest';
import { parseSvg } from './parse-svg';

// The Amendment 1 containment proof and the clip reader behind it. Since
// Amendment 2 a clip the proof cannot accept is intersected, not refused, so
// these cases now check the intersection; only clips that cannot be read
// faithfully still refuse.

const SQUARE = '<path d="M10 10 H90 V90 H10 Z" fill="black"/>';
const OUTER_RECT = '<rect width="100" height="100"/>';
const QUARTER_CLIP = '<clipPath id="quarter"><rect width="50" height="50"/></clipPath>';
const CSS_TRANSFORM_ERROR = /clip paths transformed with CSS are not supported/;

function parse(definitions: string, body = SQUARE, sheet = '') {
  return parseSvg({
    svgText:
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">' +
      `${sheet}<defs>${definitions}</defs><g clip-path="url(#outer)">${body}</g></svg>`,
    id: 'proof',
    source: 'clip.svg',
  });
}

function extent(result: ReturnType<typeof parse>): number[] {
  const points = (result.object?.paths ?? []).flatMap((path) =>
    path.polylines.flatMap((line) => line.points),
  );
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

describe('vector clip containment proof', () => {
  it.each([
    '<clipPath id="outer"><rect width="100" height="100" display="none"/></clipPath>',
    '<clipPath id="outer"><rect width="100" height="100" visibility="hidden"/></clipPath>',
    '<clipPath id="outer"><rect width="100" height="100" style="visibility:hidden"/></clipPath>',
    '<g visibility="hidden"><clipPath id="outer">' + OUTER_RECT + '</clipPath></g>',
  ])(
    'clips everything away when the only clip child contributes nothing visible: %s',
    (definition) => {
      // SVG renders such a clip as empty, so the artwork is hidden.
      expect(parse(definition).fragment?.entries).toEqual([]);
    },
  );

  it('honours stylesheet visibility on clip children', () => {
    const result = parse(
      '<clipPath id="outer"><rect class="hidden" width="100" height="100"/></clipPath>',
      SQUARE,
      '<style>.hidden { display:none }</style>',
    );
    expect(result.fragment?.entries).toEqual([]);
  });

  it.each([
    '<clipPath id="outer" style="clip-path:url(#quarter)">' + OUTER_RECT + '</clipPath>',
    '<clipPath id="outer"><rect width="100" height="100" style="clip-path:url(#quarter)"/></clipPath>',
    '<clipPath id="outer" class="nested">' + OUTER_RECT + '</clipPath>',
    '<clipPath id="outer"><rect class="nested" width="100" height="100"/></clipPath>',
  ])('intersects nested clips declared through inline or stylesheet CSS: %s', (definition) => {
    const result = parse(
      QUARTER_CLIP + definition,
      SQUARE,
      '<style>.nested { clip-path:url(#quarter) }</style>',
    );
    expect(extent(result)).toEqual([10, 10, 50, 50]);
  });

  it('refuses CSS transforms instead of interpreting them with the SVG attribute parser', () => {
    expect(() =>
      parse(
        '<clipPath id="outer"><rect width="100" height="100" style="transform:translate(200)"/></clipPath>',
      ),
    ).toThrow(CSS_TRANSFORM_ERROR);
    expect(() =>
      parse(
        '<clipPath id="outer" style="transform:scale(2)"><rect width="50" height="50"/></clipPath>',
      ),
    ).toThrow(CSS_TRANSFORM_ERROR);
  });

  it.each([
    'transform:translate(100px)',
    'transform-origin:50% 50%',
    'transform-box:fill-box',
    'translate:100px',
    'rotate:90deg',
    'scale:0.5',
  ])('refuses unsupported CSS transform context: %s', (style) => {
    expect(() =>
      parse(`<clipPath id="outer"><rect width="100" height="100" style="${style}"/></clipPath>`),
    ).toThrow(CSS_TRANSFORM_ERROR);
  });

  it('clips everything away under a clip transform that collapses it', () => {
    expect(
      parse(`<clipPath id="outer" transform="scale(0)">${OUTER_RECT}</clipPath>`).fragment?.entries,
    ).toEqual([]);
  });

  it.each(['scale(1e309)', 'matrix(1 0 0 1 1e309 0)'])(
    'refuses non-finite clip transforms: %s',
    (transform) => {
      expect(() =>
        parse(`<clipPath id="outer" transform="${transform}">${OUTER_RECT}</clipPath>`),
      ).toThrow(/transform that cannot be read/);
    },
  );

  it('does not let distant clip coordinates cancel the winding area into a false proof', () => {
    // A wrongly accepted proof would import the square; the intersection
    // instead meets the import's coordinate limit.
    expect(() =>
      parse(
        '<clipPath id="outer"><rect x="1000000000000" y="1000000000000" width="100" height="100"/></clipPath>',
      ),
    ).toThrow(/non-finite or extreme coordinates/);
  });

  it('reads a self-intersecting star clip by its clip-rule', () => {
    const star = (rule: string) =>
      parse(
        `<clipPath id="outer"><path d="M50 0 L79.4 90.5 L2.4 34.5 L97.6 34.5 L20.6 90.5 Z" ${rule}/></clipPath>`,
        '<path d="M48 48 H52 V52 H48 Z"/>',
      );
    // The centre pentagon is wound twice: even-odd hides it, nonzero keeps it.
    expect(star('clip-rule="evenodd"').fragment?.entries).toEqual([]);
    expect(extent(star(''))).toEqual([48, 48, 52, 52]);
  });

  it('refuses CSS geometry instead of intersecting against ignored attributes', () => {
    expect(() =>
      parse('<clipPath id="outer"><rect width="100" height="100" style="width:1px"/></clipPath>'),
    ).toThrow(/clip shapes sized or positioned with CSS are not supported/);
  });

  it('keeps a referenced clip available when only its container has display:none', () => {
    expect(() =>
      parse('<clipPath id="outer" display="none">' + OUTER_RECT + '</clipPath>'),
    ).not.toThrow();
    expect(() =>
      parse(
        '<g visibility="hidden"><clipPath id="outer"><rect width="100" height="100" visibility="visible"/></clipPath></g>',
      ),
    ).not.toThrow();
  });

  it.each(['M10 0 Q50 -0.2 90 0', 'M10 0 C20 -0.2 80 -0.2 90 0', 'M10 0 A40 0.2 0 0 1 90 0'])(
    'removes a native curve outside the clip despite contained sampled endpoints: %s',
    (d) => {
      const result = parse(
        '<clipPath id="outer">' + OUTER_RECT + '</clipPath>',
        `<path d="${d}" fill="none" stroke="black"/>`,
      );
      expect(result.fragment?.entries).toEqual([]);
    },
  );

  it('does not treat a flattened concave curved clip as a convex rectangle', () => {
    const result = parse(
      '<clipPath id="outer"><path d="M0 0 Q50 0.2 100 0 V100 H0 Z"/></clipPath>',
      '<path d="M10 0.05 L90 0.05" fill="none" stroke="black"/>',
    );
    // The clip's edge dips below the line in the middle, so only its ends remain.
    const pieces = result.object?.paths[0]?.polylines ?? [];
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces.map((piece) => piece.points.map((point) => point.x));
    expect(left?.[0]).toBe(10);
    expect(left?.at(-1)).toBeGreaterThan(14);
    expect(left?.at(-1)).toBeLessThan(17);
    expect(right?.[0]).toBeGreaterThan(83);
    expect(right?.[0]).toBeLessThan(86);
    expect(right?.at(-1)).toBe(90);
  });

  it('retains native curves unchanged when their control hull fits', () => {
    const body = '<path d="M10 10 Q50 80 90 10" fill="none" stroke="black"/>';
    const result = parse('<clipPath id="outer">' + OUTER_RECT + '</clipPath>', body);
    const unclipped = parseSvg({
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">' +
        body +
        '</svg>',
      id: 'proof',
      source: 'clip.svg',
    });
    expect(result.fragment).toEqual(unclipped.fragment);
    expect(result.object?.paths[0]?.curves?.[0]?.segments[0]?.kind).toBe('cubic');
  });
});
