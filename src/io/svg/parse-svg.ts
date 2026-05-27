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
  if (input === null) return COLOR_FALLBACK;
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

function walkGeometry(
  svgEl: Element,
  byColor: Map<string, Polyline[]>,
  counts: { text: number; image: number },
): void {
  for (const el of svgEl.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'text' || tag === 'tspan') {
      counts.text += 1;
      continue;
    }
    if (tag === 'image') {
      counts.image += 1;
      continue;
    }
    const subs = elementToSubPaths(el);
    if (subs.length === 0) continue;
    const color = normalizeColor(el.getAttribute('stroke'));
    if (color === '') continue;
    const arr = byColor.get(color) ?? [];
    for (const sub of subs) {
      arr.push({ points: sub.points, closed: sub.closed });
    }
    byColor.set(color, arr);
  }
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
