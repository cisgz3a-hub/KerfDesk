import { describe, expect, it } from 'vitest';
import { clipContentTransform } from './svg-clip-presentation';
import { parseSvgTransform } from './svg-transform-attribute';

function clipRect(transform: string): Element {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" transform="${transform}"/></svg>`,
    'image/svg+xml',
  );
  const rect = doc.documentElement.firstElementChild;
  if (rect === null) throw new Error('no clip shape');
  return rect;
}

describe('clipContentTransform', () => {
  // A-14: CSS Transforms 1 makes the separator between numbers optional, so
  // a compact transform reads as it does on an ordinary element.
  it.each([
    'translate(0-.5)',
    'translate(.5.5)',
    'matrix(1 0 0 1-5-3)',
    'rotate(90-5 5)',
    'scale(2,3)',
    'translate(1, 2) scale(2)',
  ])('reads %j as the general transform reader does', (transform) => {
    expect(clipContentTransform(clipRect(transform))).toEqual(parseSvgTransform(transform));
  });

  it('reads the compact numbers themselves', () => {
    expect(clipContentTransform(clipRect('matrix(1 0 0 1-5-3)'))).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: -5,
      f: -3,
    });
  });

  it.each([
    'translate(0 # 5)',
    'translate(,5)',
    'translate(5,)',
    'translate()',
    'translate(1 2 3)',
    'scale(1e309)',
    'constructor(1)',
    'translate(1) junk',
  ])('still refuses %j', (transform) => {
    expect(() => clipContentTransform(clipRect(transform))).toThrow(
      'An SVG clip path has a transform that cannot be read.',
    );
  });
});
