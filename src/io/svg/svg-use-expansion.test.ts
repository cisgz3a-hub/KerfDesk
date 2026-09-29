import { describe, expect, it } from 'vitest';
import {
  createSvgUseBudget,
  spendSvgUseElement,
  SVG_USE_EXPANSION_LIMITS,
  svgUseTarget,
} from './svg-use-expansion';

// A stand-in root holding `count` elements in all, which is all the budget reads.
function rootWith(count: number): Element {
  const children = Array.from({ length: count - 1 }, () => ({ children: [] }));
  return { children } as unknown as Element;
}

function spend(root: Element, times: number): void {
  const budget = createSvgUseBudget(root);
  for (let index = 0; index < times; index += 1) spendSvgUseElement(budget);
}

describe('spendSvgUseElement', () => {
  it('lets any file instantiate the floor, and refuses past it', () => {
    const root = rootWith(10);
    expect(() => spend(root, SVG_USE_EXPANSION_LIMITS.floor)).not.toThrow();
    expect(() => spend(root, SVG_USE_EXPANSION_LIMITS.floor + 1)).toThrow(
      'SVG <use> references expand to more than 250,000 elements',
    );
  });

  it('allows more to a file with more elements of its own', () => {
    const count = 40_000;
    const limit = SVG_USE_EXPANSION_LIMITS.perDocumentElement * count;
    const root = rootWith(count);
    expect(() => spend(root, limit)).not.toThrow();
    expect(() => spend(root, limit + 1)).toThrow(/expand to more than 400,000 elements/);
  });
});

describe('svgUseTarget', () => {
  const document = new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg"><g id="group"><use id="self" href="#self"/>' +
      '<use id="up" href="#group"/><use id="missing" href="#nothing"/>' +
      '<use id="shape-use" href="#shape"/></g><rect id="shape"/></svg>',
    'image/svg+xml',
  );
  const resolveId = (id: string) => document.getElementById(id);
  const use = (id: string) => resolveId(id) as Element;
  const group = use('group');

  it('finds the referenced element', () => {
    expect(svgUseTarget(use('shape-use'), resolveId, new Set([group]))).toBe(use('shape'));
  });

  it('reports a reference to itself or to an element being walked as circular', () => {
    expect(svgUseTarget(use('self'), resolveId, new Set())).toBe('circular');
    expect(svgUseTarget(use('up'), resolveId, new Set([group]))).toBe('circular');
  });

  it('finds nothing for a missing or non-local reference', () => {
    expect(svgUseTarget(use('missing'), resolveId, new Set())).toBeNull();
  });
});
