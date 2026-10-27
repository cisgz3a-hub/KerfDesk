import { describe, expect, it } from 'vitest';
import { DXF_BLOCK_EXPANSION_LIMITS } from '../dxf/dxf-expansion-budget';
import {
  createSvgUseBudget,
  spendSvgUseElement,
  spendSvgUsePoints,
  SVG_USE_EXPANSION_LIMITS,
  SVG_USE_POINT_LIMITS,
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

// A stand-in root whose markup holds `characters` characters, which is all the
// point budget reads.
function rootWithMarkup(characters: number): Element {
  return {
    textContent: { length: characters },
    attributes: [],
    children: [],
  } as unknown as Element;
}

const subpaths = (points: number) => [{ points: { length: points } as ReadonlyArray<unknown> }];

// Places `points` through one <use> instance in each of `steps` calls.
function place(root: Element, steps: readonly number[], nesting = 1): void {
  const budget = createSvgUseBudget(root);
  budget.nesting = nesting;
  for (const points of steps) spendSvgUsePoints(budget, subpaths(points));
}

describe('spendSvgUsePoints', () => {
  it('has the DXF block budget’s floor (ADR-269 Amendment 3)', () => {
    expect(SVG_USE_POINT_LIMITS.floor).toBe(DXF_BLOCK_EXPANSION_LIMITS.floor);
  });

  it('lets any file place the floor through <use>, and refuses past it', () => {
    const root = rootWithMarkup(100);
    expect(() => place(root, [250_000, 250_000])).not.toThrow();
    expect(() => place(root, [250_000, 250_000, 1])).toThrow(
      'SVG <use> references place more than 500,000 points',
    );
  });

  it('does not count the points the file draws without <use>', () => {
    expect(() => place(rootWithMarkup(100), [400_000, 400_000], 0)).not.toThrow();
  });

  it('allows more to a file with more markup of its own', () => {
    const root = rootWithMarkup(600_000);
    expect(() => place(root, [600_000])).not.toThrow();
    expect(() => place(root, [600_001])).toThrow(/place more than 600,000 points/);
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
