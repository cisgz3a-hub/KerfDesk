// parseSvg — full SVG → ImportedSvg pipeline.
//
// 1. Sanitize via DOMPurify (sanitize.ts) — strips <script>, foreign objects,
//    external xlink:href, non-image data URIs.
// 2. Parse the cleaned markup with the native DOMParser into a Document.
// 3. Walk every geometry-bearing element (shape-to-polylines.ts) in document
//    order — deterministic for snapshot tests.
// 4. Attribute each element to a color (stroke attribute, with a tiny named-
//    color map and hex/rgb normalization). Elements without a stroke are
//    skipped — fill-only shapes aren't cut in Line mode (ADR-005).
// 5. Bundle into an ImportedSvg with the SVG's viewBox as the natural bounds.

import {
  type Bounds,
  type ColoredPath,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
} from '../../core/scene';
import { type SvgStripCounts, sanitizeSvg } from './sanitize';
import { elementToSubPaths } from './shape-to-polylines';

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

function parseViewBox(svgEl: Element): Bounds {
  const vb = svgEl.getAttribute('viewBox');
  if (vb !== null) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [x, y, w, h] = parts as [number, number, number, number];
      return { minX: x, minY: y, maxX: x + w, maxY: y + h };
    }
  }
  const w = Number.parseFloat(svgEl.getAttribute('width') ?? '100');
  const h = Number.parseFloat(svgEl.getAttribute('height') ?? '100');
  return {
    minX: 0,
    minY: 0,
    maxX: Number.isFinite(w) ? w : 100,
    maxY: Number.isFinite(h) ? h : 100,
  };
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
  readonly transform: Matrix;
  readonly hidden: boolean;
  readonly opacity: number;
  readonly strokeOpacity: number;
  readonly visibility: string | null;
};

const IDENTITY_MATRIX: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const INITIAL_PRESENTATION_STATE: PresentationState = {
  stroke: null,
  transform: IDENTITY_MATRIX,
  hidden: false,
  opacity: 1,
  strokeOpacity: 1,
  visibility: null,
};

function walkGeometry(
  svgEl: Element,
  byColor: Map<string, Polyline[]>,
  counts: { text: number; image: number },
): void {
  const rootState = presentationStateFor(svgEl, INITIAL_PRESENTATION_STATE);
  for (const child of Array.from(svgEl.children)) {
    walkElement(child, rootState, byColor, counts);
  }
}

function walkElement(
  el: Element,
  parent: PresentationState,
  byColor: Map<string, Polyline[]>,
  counts: { text: number; image: number },
): void {
  const state = presentationStateFor(el, parent);
  const tag = el.tagName.toLowerCase();
  if (tag === 'text' || tag === 'tspan') {
    counts.text += 1;
  } else if (tag === 'image') {
    counts.image += 1;
  } else if (!state.hidden) {
    appendElementGeometry(el, state, byColor);
  }

  for (const child of Array.from(el.children)) {
    walkElement(child, state, byColor, counts);
  }
}

function appendElementGeometry(
  el: Element,
  state: PresentationState,
  byColor: Map<string, Polyline[]>,
): void {
  const subs = elementToSubPaths(el);
  if (subs.length === 0) return;
  const color = normalizeColor(state.stroke);
  if (color === '') return;
  const arr = byColor.get(color) ?? [];
  for (const sub of subs) {
    arr.push({
      points: sub.points.map((p) => applyMatrix(state.transform, p)),
      closed: sub.closed,
    });
  }
  byColor.set(color, arr);
}

function presentationStateFor(el: Element, parent: PresentationState): PresentationState {
  const stroke = presentationValue(el, 'stroke') ?? parent.stroke;
  const visibility = presentationValue(el, 'visibility') ?? parent.visibility;
  const display = presentationValue(el, 'display');
  const opacity = parent.opacity * parseOpacity(presentationValue(el, 'opacity'));
  const strokeOpacity =
    parent.strokeOpacity * parseOpacity(presentationValue(el, 'stroke-opacity'));
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
    opacity <= 0 ||
    strokeOpacity <= 0;

  return {
    stroke,
    transform,
    hidden,
    opacity,
    strokeOpacity,
    visibility,
  };
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

function transformOperation(op: string, nums: ReadonlyArray<number>): Matrix {
  switch (op) {
    case 'matrix':
      return matrixFromNumbers(nums);
    case 'translate':
      return translate(nums[0] ?? 0, nums[1] ?? 0);
    case 'scale':
      return scale(nums[0] ?? 1, nums[1] ?? nums[0] ?? 1);
    case 'rotate':
      return rotate(nums[0] ?? 0, nums[1], nums[2]);
    default:
      return IDENTITY_MATRIX;
  }
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

  const bounds = parseViewBox(svgEl);
  const byColor = new Map<string, Polyline[]>();
  const counts = { text: 0, image: 0 };
  walkGeometry(svgEl, byColor, counts);

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
