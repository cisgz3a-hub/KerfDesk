import { describe, expect, it } from 'vitest';
import { parseSvg } from './parse-svg';

// ADR-358 Amendment 1 (2026-09-25 PR audit, ART-2): #865 refused every vector
// clip, so design-tool exports that wrap their content in a frame clip imported
// nothing. A clip that provably hides none of the artwork now imports.

const SQUARE = '<path d="M10 10 H90 V90 H10 Z" fill="#000000"/>';
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLSsAAAAASUVORK5CYII=';

function svg(defs: string, body: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">' +
    `<defs>${defs}</defs>${body}</svg>`
  );
}

function parse(text: string) {
  return parseSvg({ svgText: text, id: 'O1', source: 'frame.svg' });
}

function clipped(clipPath: string): () => ReturnType<typeof parse> {
  return () => parse(svg(clipPath, `<g clip-path="url(#c)">${SQUARE}</g>`));
}

describe('vector clips that hide nothing', () => {
  it('imports artwork inside a frame-sized rectangle clip exactly as without the clip', () => {
    // Figma wraps an exported frame's content in a clip to the frame.
    const framed = clipped(
      '<clipPath id="c"><rect width="100" height="100" fill="white"/></clipPath>',
    )();
    expect(framed.fragment?.entries).toEqual(parse(svg('', SQUARE)).fragment?.entries);
  });

  it('accepts a transformed clip, and a convex clip of another shape, that contain the artwork', () => {
    expect(
      clipped('<clipPath id="c" transform="scale(2)"><rect width="50" height="50"/></clipPath>'),
    ).not.toThrow();
    expect(clipped('<clipPath id="c"><circle cx="50" cy="50" r="70"/></clipPath>')).not.toThrow();
  });

  // Amendment 2 replaced the refusal of a cutting clip with its intersection.
  it('imports the part of the artwork a cutting clip keeps', () => {
    const polylines = clipped(
      '<clipPath id="c"><rect width="50" height="100"/></clipPath>',
    )().object?.paths.flatMap((path) => path.polylines);
    const xs = polylines?.flatMap((line) => line.points.map((point) => point.x)) ?? [];
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([10, 50]);
  });

  it('imports artwork unchanged when a clip the convex proof cannot read keeps all of it', () => {
    const unclipped = parse(svg('', SQUARE)).fragment?.entries;
    for (const clipPath of [
      '<clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="1" height="1"/></clipPath>',
      '<clipPath id="c"><rect width="100" height="100"/><rect x="200" width="5" height="5"/></clipPath>',
      // Concave: the intersection, not the convex proof, shows the square is whole.
      '<clipPath id="c"><path d="M0 0 H100 V95 H95 V100 H0 Z"/></clipPath>',
    ]) {
      expect(clipped(clipPath)().fragment?.entries).toEqual(unclipped);
    }
  });
});

describe('image clip units', () => {
  it("reads an image clip without clipPathUnits as userSpaceOnUse, SVG's default", () => {
    const result = parse(
      svg(
        '<clipPath id="crop"><path clip-rule="evenodd" d="M0 0H4V4H0Z"/></clipPath>',
        `<image clip-path="url(#crop)" width="4" height="4" preserveAspectRatio="none" href="${PIXEL}"/>`,
      ),
    );
    expect(result.fragment?.entries[0]).toMatchObject({ kind: 'svg-image' });
  });
});
