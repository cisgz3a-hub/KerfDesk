// parseSvg — full SVG → ImportedSvg pipeline.
//
// 1. Sanitize via DOMPurify (sanitize.ts) — strips <script>, foreign objects,
//    external xlink:href, non-image data URIs.
// 2. Parse the cleaned markup with the native DOMParser into a Document.
// 3. Walk every geometry-bearing element (shape-to-polylines.ts) in document
//    order — deterministic for snapshot tests.
// 4. Attribute each element to stroke color, falling back to visible fill
//    color for fill-only logo artwork. Elements with neither are skipped.
// 5. Bundle into an ImportedSvg with the SVG's viewBox as the natural bounds.

import {
  type ColoredPath,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
} from '../../core/scene';
import { type SvgStripCounts, sanitizeSvg } from './sanitize';
import { elementToSubPaths } from './shape-to-polylines';
import {
  assertSvgImportPoints,
  createSvgImportBudget,
  reserveSvgPolyline,
  type SvgImportBudget,
} from './svg-import-budget';
import { resolveUnitScale } from './svg-units';

export { SVG_IMPORT_LIMITS } from './svg-import-budget';

export type ParseSvgResult = {
  readonly object: ImportedSvg | null;
  readonly stripped: SvgStripCounts;
  readonly notes: ReadonlyArray<string>;
  readonly ignoredTextElements: number;
  readonly ignoredImageElements: number;
};

const COLOR_FALLBACK = '#000000';

// CSS named colors. Phase A covers the 16 HTML basic colors plus a handful of
// common extended names. Anything else falls back to black.
const NAMED_COLORS: Readonly<Record<string, string>> = {
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
  orange: '#ffa500',
};

function clampByte(n: number): number {
  return Math.min(255, Math.max(0, n));
}

function byteToHex(n: number): string {
  return clampByte(n).toString(16).padStart(2, '0');
}

function expandShortHex(s: string): string {
  const r = s[1] ?? '0';
  const g = s[2] ?? '0';
  const b = s[3] ?? '0';
  return `#${r}${r}${g}${g}${b}${b}`;
}

function tryParseRgb(s: string): string | null {
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s);
  if (m === null) return null;
  const r = byteToHex(Number.parseInt(m[1] ?? '0', 10));
  const g = byteToHex(Number.parseInt(m[2] ?? '0', 10));
  const b = byteToHex(Number.parseInt(m[3] ?? '0', 10));
  return `#${r}${g}${b}`;
}

// Returns '' for "no stroke" (none / absent without default) — caller skips.
function normalizeColor(input: string | null): string {
  if (input === null) return '';
  const s = input.trim().toLowerCase();
  if (s === 'none' || s === '') return '';
  if (s in NAMED_COLORS) return NAMED_COLORS[s] ?? COLOR_FALLBACK;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return expandShortHex(s);
  return tryParseRgb(s) ?? COLOR_FALLBACK;
}

type Matrix = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

type PresentationState = {
  readonly stroke: string | null;
  readonly fill: string | null;
  readonly transform: Matrix;
  readonly hidden: boolean;
  readonly opacity: number;
  readonly strokeOpacity: number;
  readonly fillOpacity: number;
  readonly visibility: string | null;
};

const IDENTITY_MATRIX: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const INITIAL_PRESENTATION_STATE: PresentationState = {
  stroke: null,
  fill: null,
  transform: IDENTITY_MATRIX,
  hidden: false,
  opacity: 1,
  strokeOpacity: 1,
  fillOpacity: 1,
  visibility: null,
};

function walkGeometry(
  svgEl: Element,
  byColor: Map<string, Polyline[]>,
  counts: { text: number; image: number },
  unitScale: { readonly scaleX: number; readonly scaleY: number },
  budget: SvgImportBudget,
): void {
  // The unit scale seeds the transform stack root so every element's
  // geometry lands in mm (H9), composing with element/group transforms.
  const rootState = presentationStateFor(svgEl, {
    ...INITIAL_PRESENTATION_STATE,
    transform: { a: unitScale.scaleX, b: 0, c: 0, d: unitScale.scaleY, e: 0, f: 0 },
  });
  for (const child of Array.from(svgEl.children)) {
    walkElement(child, rootState, byColor, counts, budget, 0);
  }
}

// Recursion-depth cap for the element walk. A circular <use> chain
// (<use href="#b"/> + <use href="#a"/>) recurses without bound and overflows the
// stack; this also caps pathologically deep nesting. 256 is far beyond any real
// SVG's nesting depth (security audit 2026-06-14).
const MAX_WALK_DEPTH = 256;

function walkElement(
  el: Element,
  parent: PresentationState,
  byColor: Map<string, Polyline[]>,
  counts: { text: number; image: number },
  budget: SvgImportBudget,
  depth: number,
): void {
  if (depth > MAX_WALK_DEPTH) return;
  const state = presentationStateFor(el, parent);
  const tag = el.tagName.toLowerCase();
  if (tag === 'text' || tag === 'tspan') {
    counts.text += 1;
  } else if (tag === 'image') {
    counts.image += 1;
  } else if (tag === 'defs' || tag === 'symbol') {
    return;
  } else if (tag === 'use' && !state.hidden) {
    appendUseGeometry(el, state, byColor, counts, budget, depth);
  } else if (!state.hidden) {
    appendElementGeometry(el, state, byColor, budget);
  }

  for (const child of Array.from(el.children)) {
    walkElement(child, state, byColor, counts, budget, depth + 1);
  }
}

function appendUseGeometry(
  el: Element,
  state: PresentationState,
  byColor: Map<string, Polyline[]>,
  counts: { text: number; image: number },
  budget: SvgImportBudget,
  depth: number,
): void {
  const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
  if (href === null || !href.startsWith('#') || href.length <= 1) return;
  const owner = el.ownerDocument;
  const referenced = owner.getElementById(href.slice(1));
  if (referenced === null || referenced === el) return;
  const placedState = {
    ...state,
    transform: multiplyMatrix(state.transform, translate(numAttr(el, 'x'), numAttr(el, 'y'))),
  };
  if (isDefinitionContainer(referenced)) {
    walkReferencedDefinition(referenced, placedState, byColor, counts, budget, depth + 1);
    return;
  }
  walkElement(referenced, placedState, byColor, counts, budget, depth + 1);
}

function appendElementGeometry(
  el: Element,
  state: PresentationState,
  byColor: Map<string, Polyline[]>,
  budget: SvgImportBudget,
): void {
  const subs = elementToSubPaths(el);
  if (subs.length === 0) return;
  const strokeColor = state.strokeOpacity > 0 ? normalizeColor(state.stroke) : '';
  const fillColor = state.fillOpacity > 0 ? normalizeColor(state.fill) : '';
  const color = strokeColor !== '' ? strokeColor : fillColor;
  if (color === '') return;
  const arr = byColor.get(color) ?? [];
  for (const sub of subs) {
    reserveSvgPolyline(color, sub.points.length, budget);
    const points = sub.points.map((p) => applyMatrix(state.transform, p));
    assertSvgImportPoints(points);
    arr.push({
      points,
      closed: sub.closed,
    });
  }
  byColor.set(color, arr);
}

function isDefinitionContainer(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === 'defs' || tag === 'symbol';
}

function walkReferencedDefinition(
  el: Element,
  parent: PresentationState,
  byColor: Map<string, Polyline[]>,
  counts: { text: number; image: number },
  budget: SvgImportBudget,
  depth: number,
): void {
  const state = presentationStateFor(el, parent);
  for (const child of Array.from(el.children)) {
    walkElement(child, state, byColor, counts, budget, depth + 1);
  }
}

function presentationStateFor(el: Element, parent: PresentationState): PresentationState {
  const stroke = presentationValue(el, 'stroke') ?? parent.stroke;
  const fill = presentationValue(el, 'fill') ?? parent.fill;
  const visibility = presentationValue(el, 'visibility') ?? parent.visibility;
  const display = presentationValue(el, 'display');
  const opacity = parent.opacity * parseOpacity(presentationValue(el, 'opacity'));
  const strokeOpacity =
    parent.strokeOpacity * parseOpacity(presentationValue(el, 'stroke-opacity'));
  const fillOpacity = parent.fillOpacity * parseOpacity(presentationValue(el, 'fill-opacity'));
  const transform = multiplyMatrix(
    parent.transform,
    parseTransform(presentationValue(el, 'transform')),
  );
  const normalizedVisibility = visibility?.trim().toLowerCase();
  const hidden =
    parent.hidden ||
    display?.trim().toLowerCase() === 'none' ||
    normalizedVisibility === 'hidden' ||
    normalizedVisibility === 'collapse' ||
    opacity <= 0;

  return {
    stroke,
    fill,
    transform,
    hidden,
    opacity,
    strokeOpacity,
    fillOpacity,
    visibility,
  };
}

function numAttr(el: Element, name: string, fallback = 0): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function presentationValue(el: Element, name: string): string | null {
  const styleValue = styleMap(el.getAttribute('style')).get(name);
  if (styleValue !== undefined) return styleValue;
  return el.getAttribute(name);
}

function styleMap(style: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (style === null) return map;
  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (name !== '') map.set(name, value);
  }
  return map;
}

function parseOpacity(input: string | null): number {
  if (input === null) return 1;
  const value = Number.parseFloat(input);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function parseTransform(input: string | null): Matrix {
  if (input === null || input.trim() === '') return IDENTITY_MATRIX;
  let matrix = IDENTITY_MATRIX;
  for (const match of input.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const op = match[1]?.toLowerCase();
    const nums = parseTransformNumbers(match[2] ?? '');
    matrix = multiplyMatrix(
      matrix,
      op === undefined ? IDENTITY_MATRIX : transformOperation(op, nums),
    );
  }
  return matrix;
}

function parseTransformNumbers(input: string): ReadonlyArray<number> {
  return (input.match(/[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/g) ?? [])
    .map(Number)
    .filter(Number.isFinite);
}

// Dispatch table per SVG transform function (lower-cased). A map keeps the
// per-op cyclomatic complexity out of one switch as the op set grows (skewX/
// skewY were added for H4); each builder applies the SVG spec defaults for
// its own missing args. Unknown ops resolve to identity.
const TRANSFORM_BUILDERS: Record<string, (nums: ReadonlyArray<number>) => Matrix> = {
  matrix: (n) => matrixFromNumbers(n),
  translate: (n) => translate(n[0] ?? 0, n[1] ?? 0),
  scale: (n) => scale(n[0] ?? 1, n[1] ?? n[0] ?? 1),
  rotate: (n) => rotate(n[0] ?? 0, n[1], n[2]),
  skewx: (n) => ({ a: 1, b: 0, c: tanDeg(n[0] ?? 0), d: 1, e: 0, f: 0 }),
  skewy: (n) => ({ a: 1, b: tanDeg(n[0] ?? 0), c: 0, d: 1, e: 0, f: 0 }),
};

function transformOperation(op: string, nums: ReadonlyArray<number>): Matrix {
  return (TRANSFORM_BUILDERS[op] ?? (() => IDENTITY_MATRIX))(nums);
}

function tanDeg(deg: number): number {
  return Math.tan((deg / 180) * Math.PI);
}

function matrixFromNumbers(nums: ReadonlyArray<number>): Matrix {
  if (nums.length < 6) return IDENTITY_MATRIX;
  return {
    a: nums[0] ?? 1,
    b: nums[1] ?? 0,
    c: nums[2] ?? 0,
    d: nums[3] ?? 1,
    e: nums[4] ?? 0,
    f: nums[5] ?? 0,
  };
}

function translate(x: number, y: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

function scale(x: number, y: number): Matrix {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

function rotate(deg: number, cx?: number, cy?: number): Matrix {
  const rad = (deg / 180) * Math.PI;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotation = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  if (cx === undefined || cy === undefined) return rotation;
  return multiplyMatrix(multiplyMatrix(translate(cx, cy), rotation), translate(-cx, -cy));
}

function multiplyMatrix(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function applyMatrix(
  matrix: Matrix,
  point: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function parseSvg(args: { svgText: string; id: string; source: string }): ParseSvgResult {
  const { clean, stripped } = sanitizeSvg(args.svgText);

  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError !== null) {
    const msg = parserError.textContent?.split('\n')[0] ?? 'invalid SVG';
    throw new Error(`SVG parse error: ${msg}`);
  }

  const svgEl = doc.documentElement;
  if (svgEl.tagName.toLowerCase() !== 'svg') {
    throw new Error(`Not an SVG document: root is <${svgEl.tagName}>`);
  }

  const unitScale = resolveUnitScale(svgEl);
  const bounds = unitScale.bounds;
  assertSvgImportPoints([
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
  ]);
  const byColor = new Map<string, Polyline[]>();
  const counts = { text: 0, image: 0 };
  const budget = createSvgImportBudget();
  walkGeometry(svgEl, byColor, counts, unitScale, budget);

  const paths: ColoredPath[] = [...byColor.entries()].map(([color, polylines]) => ({
    color,
    polylines,
  }));

  const notes: string[] = [];
  if (paths.length === 0) notes.push('SVG has no drawable geometry');
  if (counts.text > 0) {
    notes.push(`Ignored ${counts.text} text element(s) — convert to paths or wait for Phase D`);
  }
  if (counts.image > 0) {
    notes.push(`Ignored ${counts.image} image element(s) — Phase E adds raster tracing`);
  }

  return {
    object:
      paths.length === 0
        ? null
        : {
            kind: 'imported-svg',
            id: args.id,
            source: args.source,
            bounds,
            transform: IDENTITY_TRANSFORM,
            paths,
          },
    stripped,
    notes,
    ignoredTextElements: counts.text,
    ignoredImageElements: counts.image,
  };
}
