import { describe, expect, it } from 'vitest';
import { parseSvg } from './parse-svg';

const SQUARE = '<path d="M10 10 H90 V90 H10 Z" fill="black"/>';
const OUTER_RECT = '<rect width="100" height="100"/>';
const TINY_CLIP = '<clipPath id="tiny"><rect width="5" height="5"/></clipPath>';
const CLIP_ERROR = /vector clipping is not supported/i;

function parse(definitions: string, body = SQUARE, sheet = '') {
  return parseSvg({
    svgText:
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">' +
      `${sheet}<defs>${definitions}</defs><g clip-path="url(#outer)">${body}</g></svg>`,
    id: 'proof',
    source: 'clip.svg',
  });
}

describe('vector clip containment proof', () => {
  it.each([
    '<clipPath id="outer"><rect width="100" height="100" display="none"/></clipPath>',
    '<clipPath id="outer"><rect width="100" height="100" visibility="hidden"/></clipPath>',
    '<clipPath id="outer"><rect width="100" height="100" style="visibility:hidden"/></clipPath>',
    '<g visibility="hidden"><clipPath id="outer">' + OUTER_RECT + '</clipPath></g>',
  ])('refuses a clip whose only child contributes no visible geometry: %s', (definition) => {
    expect(() => parse(definition)).toThrow(CLIP_ERROR);
  });

  it('honours stylesheet visibility on clip children', () => {
    expect(() =>
      parse(
        '<clipPath id="outer"><rect class="hidden" width="100" height="100"/></clipPath>',
        SQUARE,
        '<style>.hidden { display:none }</style>',
      ),
    ).toThrow(CLIP_ERROR);
  });

  it.each([
    '<clipPath id="outer" style="clip-path:url(#tiny)">' + OUTER_RECT + '</clipPath>',
    '<clipPath id="outer"><rect width="100" height="100" style="clip-path:url(#tiny)"/></clipPath>',
    '<clipPath id="outer" class="nested">' + OUTER_RECT + '</clipPath>',
    '<clipPath id="outer"><rect class="nested" width="100" height="100"/></clipPath>',
  ])('refuses nested clips declared through inline or stylesheet CSS: %s', (definition) => {
    expect(() =>
      parse(TINY_CLIP + definition, SQUARE, '<style>.nested { clip-path:url(#tiny) }</style>'),
    ).toThrow(CLIP_ERROR);
  });

  it('refuses CSS transforms instead of interpreting them with the SVG attribute parser', () => {
    expect(() =>
      parse(
        '<clipPath id="outer"><rect width="100" height="100" style="transform:translate(200)"/></clipPath>',
      ),
    ).toThrow(CLIP_ERROR);
    expect(() =>
      parse(
        '<clipPath id="outer" style="transform:scale(2)"><rect width="50" height="50"/></clipPath>',
      ),
    ).toThrow(CLIP_ERROR);
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
    ).toThrow(CLIP_ERROR);
  });

  it.each(['scale(0)', 'scale(1e309)', 'matrix(1 0 0 1 1e309 0)'])(
    'refuses degenerate or non-finite clip transforms: %s',
    (transform) => {
      expect(() =>
        parse(`<clipPath id="outer" transform="${transform}">${OUTER_RECT}</clipPath>`),
      ).toThrow(CLIP_ERROR);
    },
  );

  it('keeps distant clip coordinates from cancelling the winding area', () => {
    expect(() =>
      parse(
        '<clipPath id="outer"><rect x="1000000000000" y="1000000000000" width="100" height="100"/></clipPath>',
      ),
    ).toThrow(CLIP_ERROR);
  });

  it('refuses a self-intersecting star even when every vertex turns the same way', () => {
    expect(() =>
      parse(
        '<clipPath id="outer"><path d="M50 0 L79.4 90.5 L2.4 34.5 L97.6 34.5 L20.6 90.5 Z" clip-rule="evenodd"/></clipPath>',
        '<path d="M48 48 H52 V52 H48 Z"/>',
      ),
    ).toThrow(CLIP_ERROR);
  });

  it('refuses CSS geometry instead of proving containment against ignored attributes', () => {
    expect(() =>
      parse('<clipPath id="outer"><rect width="100" height="100" style="width:1px"/></clipPath>'),
    ).toThrow(CLIP_ERROR);
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
    'refuses a native curve outside the clip despite contained sampled endpoints: %s',
    (d) => {
      expect(() =>
        parse(
          '<clipPath id="outer">' + OUTER_RECT + '</clipPath>',
          `<path d="${d}" fill="none" stroke="black"/>`,
        ),
      ).toThrow(CLIP_ERROR);
    },
  );

  it('does not treat a flattened concave curved clip as a convex rectangle', () => {
    expect(() =>
      parse(
        '<clipPath id="outer"><path d="M0 0 Q50 0.2 100 0 V100 H0 Z"/></clipPath>',
        '<path d="M10 0.05 L90 0.05" fill="none" stroke="black"/>',
      ),
    ).toThrow(CLIP_ERROR);
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
