// <use> instances (SVG 2 struct.html#UseElement), shared by the import walk
// and the object bounding box walk.
//
// Circular references: a <use> whose target is the <use> itself, or an element
// the walk is already inside (its ancestors, and the targets of the <use>
// elements that led to it), "is in error and must not be rendered". Walking it
// anyway imported the same geometry once per level until the depth cap, 128
// cuts of one line (audit A-09).
//
// Expansion budget (ADR-268 Amendment 1): each level of a use-of-use chain can
// multiply the instances, so a file of a few hundred bytes expands
// exponentially, the SVG analogue of billion laughs (audit A-05). Unlike the
// advisory size notes of ADR-268 item 4, this growth is not bounded by the
// input, so past the budget the import is refused.

import type { SvgIdResolver } from './svg-id-resolver';

export const SVG_USE_EXPANSION_LIMITS = {
  // Elements any file may instantiate through <use>, however small it is:
  // five times the size at which an import is already reported as large.
  floor: 250_000,
  // Beyond the floor, instantiated elements per element of the file itself.
  // Text drawn as glyph <use>s instantiates two per <use>.
  perDocumentElement: 10,
} as const;

export type SvgUseBudget = {
  /** Elements instantiated through <use> so far. */
  instantiated: number;
  /** How many <use> instances the walk is currently inside. */
  nesting: number;
  limit: number | null;
  readonly root: Element;
};

export function createSvgUseBudget(root: Element): SvgUseBudget {
  return { instantiated: 0, nesting: 0, limit: null, root };
}

/** Counts one element a <use> instantiates; refuses the import past the budget. */
export function spendSvgUseElement(budget: SvgUseBudget): void {
  budget.instantiated += 1;
  if (budget.instantiated <= SVG_USE_EXPANSION_LIMITS.floor) return;
  // Counted once, and only for files that pass the floor.
  budget.limit ??= Math.max(
    SVG_USE_EXPANSION_LIMITS.floor,
    SVG_USE_EXPANSION_LIMITS.perDocumentElement * elementCount(budget.root),
  );
  if (budget.instantiated > budget.limit) {
    throw new Error(
      `SVG <use> references expand to more than ${budget.limit.toLocaleString('en-US')} ` +
        'elements, far more than the file holds; such files are refused because they ' +
        'expand without bound (for example, uses of uses of uses).',
    );
  }
}

/**
 * The element a <use> instantiates: null when it names no element of this
 * document, 'circular' when the target is the <use> itself or an element in
 * `active`, the elements the walk is inside.
 */
export function svgUseTarget(
  use: Element,
  resolveId: SvgIdResolver,
  active: ReadonlySet<Element>,
): Element | 'circular' | null {
  const href = use.getAttribute('href') ?? use.getAttribute('xlink:href');
  if (href === null || !href.startsWith('#') || href.length <= 1) return null;
  const target = resolveId(href.slice(1));
  if (target === null) return null;
  return target === use || active.has(target) ? 'circular' : target;
}

// Walks `children` because linkedom's getElementsByTagName has no '*' wildcard.
function elementCount(root: Element): number {
  let count = 0;
  const pending: Element[] = [root];
  for (let element = pending.pop(); element !== undefined; element = pending.pop()) {
    count += 1;
    for (const child of Array.from(element.children)) pending.push(child);
  }
  return count;
}
