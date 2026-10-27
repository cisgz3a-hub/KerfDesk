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
//
// The budget also counts the points those elements place (ADR-269 Amendment 3),
// with the DXF block budget's limit (ADR-269 Amendment 1): one instantiated
// path can carry many points, so counting elements alone does not bound them.

import type { SvgIdResolver } from './svg-id-resolver';

export const SVG_USE_EXPANSION_LIMITS = {
  // Elements any file may instantiate through <use>, however small it is:
  // five times the size at which an import is already reported as large.
  floor: 250_000,
  // Beyond the floor, instantiated elements per element of the file itself.
  // Text drawn as glyph <use>s instantiates two per <use>.
  perDocumentElement: 10,
} as const;

export const SVG_USE_POINT_LIMITS = {
  // Points any file may place through <use>, however small it is: the DXF
  // block budget's floor (DXF_BLOCK_EXPANSION_LIMITS).
  floor: 500_000,
  // Beyond the floor, placed points per character of the file's markup.
  // Writing a point takes at least three characters ("1 1"), so this is several times
  // what the file could draw by itself.
  perDocumentCharacter: 1,
} as const;

export type SvgUseBudget = {
  /** Elements instantiated through <use> so far. */
  instantiated: number;
  /** Points the elements instantiated through <use> have placed so far. */
  placedPoints: number;
  /** How many <use> instances the walk is currently inside. */
  nesting: number;
  limit: number | null;
  pointLimit: number | null;
  readonly root: Element;
};

export function createSvgUseBudget(root: Element): SvgUseBudget {
  return { instantiated: 0, placedPoints: 0, nesting: 0, limit: null, pointLimit: null, root };
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
 * Counts the points an element places when the walk is inside a <use>
 * instance; refuses the import past the budget. Outside <use> the points are
 * the file's own, so they are not counted.
 */
export function spendSvgUsePoints(
  budget: SvgUseBudget,
  subpaths: ReadonlyArray<{ readonly points: ReadonlyArray<unknown> }>,
): void {
  if (budget.nesting === 0) return;
  for (const subpath of subpaths) budget.placedPoints += subpath.points.length;
  if (budget.placedPoints <= SVG_USE_POINT_LIMITS.floor) return;
  // Measured once, and only for files that pass the floor.
  budget.pointLimit ??= Math.max(
    SVG_USE_POINT_LIMITS.floor,
    SVG_USE_POINT_LIMITS.perDocumentCharacter * markupCharacters(budget.root),
  );
  if (budget.placedPoints > budget.pointLimit) {
    throw new Error(
      `SVG <use> references place more than ${budget.pointLimit.toLocaleString('en-US')} ` +
        'points, far more than the file holds; such files are refused because they ' +
        'expand without bound (for example, uses of uses of uses). To import the ' +
        'drawing, convert its clones to paths in the drawing program first.',
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

// The markup's attribute values and text: what the file spends on geometry.
function markupCharacters(root: Element): number {
  let count = root.textContent?.length ?? 0;
  const pending: Element[] = [root];
  for (let element = pending.pop(); element !== undefined; element = pending.pop()) {
    for (const attribute of Array.from(element.attributes)) count += attribute.value.length;
    for (const child of Array.from(element.children)) pending.push(child);
  }
  return count;
}
