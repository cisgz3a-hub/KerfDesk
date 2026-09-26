// One element of the triangulated heightmap (ADR-412): the quad whose top-left
// sample is (i, j), its included corners, the triangles of its upper envelope
// and the edges it owns. heightmap-surface-contact.ts chooses which elements
// can reach the cutter; heightmap-surface-contact-geometry.ts solves each
// triangle and edge.

import {
  type ContactLaw,
  edgeContact,
  facetContact,
  PRUNE_TOLERANCE_MM,
} from './heightmap-surface-contact-geometry';

// Corner bits of the element whose top-left sample is (i, j):
// a = (i, j), b = (i + 1, j), c = (i, j + 1), d = (i + 1, j + 1).
export const A = 1;
export const B = 2;
export const C = 4;
export const D = 8;
const ALL_CORNERS = A | B | C | D;

/** The sample grid plus the cutter law an element is solved against. */
export type ElementContact = ContactLaw & {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly depth: Float32Array;
  readonly inclusion: Uint8Array | undefined;
};

// Indexes are always in range; NaN would fail every comparison. One reader
// per array type keeps these hot loads monomorphic.
export function read64(values: Float64Array, index: number): number {
  return values[index] ?? Number.NaN;
}

export function read32(values: Float32Array, index: number): number {
  return values[index] ?? Number.NaN;
}

export function readInt(values: Int32Array, index: number): number {
  return values[index] ?? 0;
}

export function isIncluded(inclusion: Uint8Array | undefined, index: number): boolean {
  return inclusion === undefined || inclusion[index] !== 0;
}

// Element (i, j) owns its top edge a-b, its left edge a-c and, when all four
// corners exist, both diagonals and the four triangles of the two splits. Its
// right and bottom edges belong to the neighbouring elements, which the
// caller's range always visits when they can reach the cutter. Corners are
// read as plain numbers: this runs millions of times per relief.
export type ElementCorners = {
  xa: number;
  xb: number;
  ya: number;
  yc: number;
  za: number;
  zb: number;
  zc: number;
  zd: number;
  // Included corners, as A | B | C | D bits.
  mask: number;
};

export const corners: ElementCorners = {
  xa: 0,
  xb: 0,
  ya: 0,
  yc: 0,
  za: 0,
  zb: 0,
  zc: 0,
  zd: 0,
  mask: 0,
};

export function readCorners(
  contact: ElementContact,
  i: number,
  j: number,
  out: ElementCorners,
): void {
  const { widthCells, inclusion, depth } = contact;
  const right = i + 1 < widthCells;
  const below = j + 1 < contact.heightCells;
  const ia = j * widthCells + i;
  const ib = right ? ia + 1 : ia;
  const ic = below ? ia + widthCells : ia;
  const id = right ? ic + 1 : ic;
  out.xa = read64(contact.xs, i);
  out.xb = read64(contact.xs, right ? i + 1 : i);
  out.ya = read64(contact.ys, j);
  out.yc = read64(contact.ys, below ? j + 1 : j);
  out.za = read32(depth, ia);
  out.zb = read32(depth, ib);
  out.zc = read32(depth, ic);
  out.zd = read32(depth, id);
  out.mask =
    Number(isIncluded(inclusion, ia)) * A +
    Number(right && isIncluded(inclusion, ib)) * B +
    Number(below && isIncluded(inclusion, ic)) * C +
    Number(right && below && isIncluded(inclusion, id)) * D;
}

function hasCorners(mask: number, required: number): boolean {
  return (mask & required) === required;
}

type FacetPass = { best: number; planeBound: number };
const facetPass: FacetPass = { best: 0, planeBound: 0 };

// Parts of an element that can hold its maximum. Only included corners make
// triangles. With all four corners the two splits differ by
// (za + zd - zb - zc) times a nonnegative tent, so one split lies on top
// everywhere: the upper envelope is that split alone, and the other diagonal
// lies under it. A planar quad needs neither diagonal.
const T_ABD = 1;
const T_ADC = 2;
const T_ABC = 4;
const T_BDC = 8;
const E_AD = 16;
const E_BC = 32;
const PLANAR = 64;

function liveParts(k: ElementCorners): number {
  if (k.mask === ALL_CORNERS) {
    const twist = k.za + k.zd - k.zb - k.zc;
    if (Math.abs(twist) <= PRUNE_TOLERANCE_MM) return PLANAR;
    return twist > 0 ? T_ABD | T_ADC | E_AD : T_ABC | T_BDC | E_BC;
  }
  return (
    Number(hasCorners(k.mask, A | B | D)) * T_ABD +
    Number(hasCorners(k.mask, A | D | C)) * T_ADC +
    Number(hasCorners(k.mask, A | B | C)) * T_ABC +
    Number(hasCorners(k.mask, B | D | C)) * T_BDC +
    Number(hasCorners(k.mask, A | D)) * E_AD +
    Number(hasCorners(k.mask, B | C)) * E_BC
  );
}

export function elementFacets(
  contact: ElementContact,
  i: number,
  j: number,
  xc: number,
  yc: number,
  lowerBound: number,
): FacetPass {
  const k = corners;
  readCorners(contact, i, j, k);
  const live = liveParts(k);
  // A planar quad is one plane: solve it once over the whole rectangle.
  if (
    live === PLANAR &&
    facetContact(contact, k.xa, k.ya, k.za, k.xb, k.ya, k.zb, k.xa, k.yc, k.zc, xc, yc)
  ) {
    facetPass.best = Math.max(lowerBound, contact.facet.insideRectangle);
    facetPass.planeBound = contact.facet.planeBound;
    return facetPass;
  }
  facetPass.best = lowerBound;
  facetPass.planeBound = Number.NEGATIVE_INFINITY;
  let facets = 0;
  if (live & T_ABD) {
    facets += addFacet(contact, k.xa, k.ya, k.za, k.xb, k.ya, k.zb, k.xb, k.yc, k.zd, xc, yc);
  }
  if (live & T_ADC) {
    facets += addFacet(contact, k.xa, k.ya, k.za, k.xb, k.yc, k.zd, k.xa, k.yc, k.zc, xc, yc);
  }
  if (live & T_ABC) {
    facets += addFacet(contact, k.xa, k.ya, k.za, k.xb, k.ya, k.zb, k.xa, k.yc, k.zc, xc, yc);
  }
  if (live & T_BDC) {
    facets += addFacet(contact, k.xb, k.ya, k.zb, k.xb, k.yc, k.zd, k.xa, k.yc, k.zc, xc, yc);
  }
  // An element with an edge but no complete facet (a masked corner or the last
  // row or column) keeps its corner bound: its edges must still be searched.
  if (facets === 0) facetPass.planeBound = Number.POSITIVE_INFINITY;
  return facetPass;
}

function addFacet(
  contact: ElementContact,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  xc: number,
  yc: number,
): number {
  if (!facetContact(contact, x0, y0, z0, x1, y1, z1, x2, y2, z2, xc, yc)) return 0;
  facetPass.planeBound = Math.max(facetPass.planeBound, contact.facet.planeBound);
  facetPass.best = Math.max(facetPass.best, contact.facet.candidate);
  return 1;
}

export function elementEdges(
  contact: ElementContact,
  i: number,
  j: number,
  xc: number,
  yc: number,
  lowerBound: number,
): number {
  const k = corners;
  readCorners(contact, i, j, k);
  let best = lowerBound;
  if (hasCorners(k.mask, A | B)) {
    best = edgeContact(contact, k.xa, k.ya, k.za, k.xb, k.ya, k.zb, xc, yc, best);
  }
  if (hasCorners(k.mask, A | C)) {
    best = edgeContact(contact, k.xa, k.ya, k.za, k.xa, k.yc, k.zc, xc, yc, best);
  }
  const live = liveParts(k);
  if (live & E_AD) {
    best = edgeContact(contact, k.xa, k.ya, k.za, k.xb, k.yc, k.zd, xc, yc, best);
  }
  if (live & E_BC) {
    best = edgeContact(contact, k.xb, k.ya, k.zb, k.xa, k.yc, k.zc, xc, yc, best);
  }
  return best;
}

// Insertion sort: a center has a handful of candidate elements.
export function sortByBoundDescending(
  elements: Int32Array,
  bounds: Float64Array,
  count: number,
): void {
  for (let k = 1; k < count; k += 1) {
    const element = readInt(elements, k);
    const bound = read64(bounds, k);
    let m = k - 1;
    while (m >= 0 && read64(bounds, m) < bound) {
      elements[m + 1] = readInt(elements, m);
      bounds[m + 1] = read64(bounds, m);
      m -= 1;
    }
    elements[m + 1] = element;
    bounds[m + 1] = bound;
  }
}
