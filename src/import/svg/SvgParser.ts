/**
 * === FILE: /src/import/svg/SvgParser.ts ===
 *
 * Purpose:    Parse an SVG string into a flat list of typed elements
 *             with accumulated transforms. Uses xmldom for XML parsing.
 *
 *             Traversal:
 *             1. Parse XML → DOM
 *             2. Walk DOM recursively
 *             3. Accumulate group transforms down the tree
 *             4. Extract typed element data (tag, attributes, world transform)
 *
 * Dependencies:
 *   - @xmldom/xmldom (XML parser)
 *   - /src/import/svg/TransformParser.ts
 * Last updated: SVG Import feature
 */

import { DOMParser } from '@xmldom/xmldom';
import { type Matrix3x2, IDENTITY_MATRIX } from '../../core/types';
import { parseTransform, multiplyMatrix } from './TransformParser';

// ─── PUBLIC TYPES ────────────────────────────────────────────────

export interface SvgElement {
  tag: string;                     // 'rect', 'circle', 'path', etc.
  attrs: Record<string, string>;   // Raw attribute values
  worldTransform: Matrix3x2;       // Accumulated transform (groups × own)
}

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * Parse an SVG string into a flat list of renderable elements.
 * Groups are flattened — each element carries its accumulated transform.
 * Returns an empty array if parsing fails.
 */
export type SvgUnitMode = 'laser' | 'spec';

/** laser: viewBox user units = mm (default). spec: viewBox-only SVGs scale user units as CSS px → mm. */
export interface ParseSvgOptions {
  unitMode?: SvgUnitMode;
}

export interface SvgParseResult {
  elements: SvgElement[];
  viewBox: { x: number; y: number; width: number; height: number } | null;
  widthMm: number;         // Physical width in mm
  heightMm: number;        // Physical height in mm
  svgUnits: 'mm' | 'px';  // Detected unit system
}

const EMPTY_RESULT: SvgParseResult = {
  elements: [], viewBox: null, widthMm: 400, heightMm: 400, svgUnits: 'px',
};

/**
 * Parse an SVG string into a flat list of renderable elements.
 * Groups are flattened — each element carries its accumulated transform.
 *
 * Handles units: all coordinates are converted to mm.
 * Handles viewBox: computes scale transform from viewBox to physical size.
 */
export function parseSvg(svgString: string, options?: ParseSvgOptions): SvgParseResult {
  if (!svgString || svgString.trim() === '') return EMPTY_RESULT;

  const unitMode: SvgUnitMode = options?.unitMode ?? 'laser';

  let doc: any;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(svgString, 'image/svg+xml');
  } catch {
    return EMPTY_RESULT;
  }

  const svgRoot = doc.getElementsByTagName('svg')[0];
  if (!svgRoot) return EMPTY_RESULT;

  // Parse viewBox and physical dimensions
  const viewBox = parseViewBox(svgRoot.getAttribute('viewBox'));
  const widthParsed = parseLength(svgRoot.getAttribute('width'));
  const heightParsed = parseLength(svgRoot.getAttribute('height'));
  const svgUnits = detectSvgUnits(
    svgRoot.getAttribute('width'),
    svgRoot.getAttribute('height')
  );

  // Compute physical dimensions in mm and root transform
  const { widthMm, heightMm, rootTransform } = computeRootTransform(
    viewBox, widthParsed, heightParsed, svgUnits, unitMode,
  );

  // Traverse and collect elements with root transform applied
  const elements: SvgElement[] = [];
  traverse(svgRoot, rootTransform, elements);

  return { elements, viewBox, widthMm, heightMm, svgUnits };
}

/**
 * Compute the root transform that maps SVG user units → mm.
 *
 * Priority:
 * 1. width/height (mm) + viewBox → scale viewBox to mm
 * 2. width/height (mm) only → 1:1 (coords already in mm)
 * 3. viewBox only → assume 1 user unit = 1mm (laser convention)
 * 4. width/height (px) + viewBox → convert to mm, then scale
 * 5. width/height (px) only → convert px→mm at 96 DPI
 * 6. Nothing → default 400×400mm, identity transform
 */
function computeRootTransform(
  viewBox: { x: number; y: number; width: number; height: number } | null,
  widthParsed: ParsedLength | null,
  heightParsed: ParsedLength | null,
  svgUnits: 'mm' | 'px',
  unitMode: SvgUnitMode,
): { widthMm: number; heightMm: number; rootTransform: Matrix3x2 } {
  let widthMm: number;
  let heightMm: number;

  const strictViewBoxOnly = Boolean(viewBox && !widthParsed && !heightParsed);

  if (widthParsed && heightParsed) {
    widthMm = widthParsed.mm;
    heightMm = heightParsed.mm;
  } else if (viewBox) {
    if (unitMode === 'spec' && strictViewBoxOnly) {
      const px = SVG_UNIT_TO_MM['px'];
      widthMm = viewBox.width * px;
      heightMm = viewBox.height * px;
    } else if (svgUnits === 'mm') {
      widthMm = viewBox.width;
      heightMm = viewBox.height;
    } else {
      // Assume viewBox units = px, convert to mm
      widthMm = viewBox.width * SVG_UNIT_TO_MM['px'];
      heightMm = viewBox.height * SVG_UNIT_TO_MM['px'];
    }
  } else {
    widthMm = 400;
    heightMm = 400;
  }

  // Compute root transform
  if (viewBox && widthParsed && heightParsed) {
    // ViewBox + dimensions: scale viewBox → physical size
    const sx = widthMm / viewBox.width;
    const sy = heightMm / viewBox.height;
    const tx = -viewBox.x * sx;
    const ty = -viewBox.y * sy;
    return { widthMm, heightMm, rootTransform: { a: sx, b: 0, c: 0, d: sy, tx, ty } };
  }

  if (viewBox) {
    if (unitMode === 'spec' && strictViewBoxOnly) {
      const s = SVG_UNIT_TO_MM['px'];
      const tx = -viewBox.x * s;
      const ty = -viewBox.y * s;
      return { widthMm, heightMm, rootTransform: { a: s, b: 0, c: 0, d: s, tx, ty } };
    }
    // Laser / default: viewBox user units = mm
    const tx = -viewBox.x;
    const ty = -viewBox.y;
    if (tx === 0 && ty === 0) {
      return { widthMm, heightMm, rootTransform: { ...IDENTITY_MATRIX } };
    }
    return { widthMm, heightMm, rootTransform: { a: 1, b: 0, c: 0, d: 1, tx, ty } };
  }

  if (widthParsed && svgUnits === 'px') {
    // Pixel dimensions only: scale px→mm
    const pxToMm = SVG_UNIT_TO_MM['px'];
    return { widthMm, heightMm, rootTransform: { a: pxToMm, b: 0, c: 0, d: pxToMm, tx: 0, ty: 0 } };
  }

  // mm dimensions or nothing: identity
  return { widthMm, heightMm, rootTransform: { ...IDENTITY_MATRIX } };
}

// ─── DOM TRAVERSAL ───────────────────────────────────────────────

const RENDERABLE_TAGS = new Set([
  'rect', 'circle', 'ellipse', 'line',
  'polyline', 'polygon', 'path',
]);

function traverse(
  node: Element,
  parentTransform: Matrix3x2,
  output: SvgElement[]
): void {
  const childNodes = node.childNodes;
  if (!childNodes) return;

  for (let i = 0; i < childNodes.length; i++) {
    const child = childNodes[i] as Element;
    if (!child.tagName) continue;  // Skip text nodes

    const tag = child.tagName.toLowerCase().replace(/^svg:/, '');
    const ownTransform = parseTransform(child.getAttribute('transform'));
    const worldTransform = multiplyMatrix(parentTransform, ownTransform);

    if (tag === 'g' || tag === 'svg') {
      // Group: recurse with accumulated transform
      traverse(child, worldTransform, output);
    } else if (RENDERABLE_TAGS.has(tag)) {
      // Renderable element: extract attributes
      const attrs = extractAttributes(child);
      output.push({ tag, attrs, worldTransform });
    }
    // Skip: text, defs, style, clipPath, mask, etc.
  }
}

// ─── ATTRIBUTE EXTRACTION ────────────────────────────────────────

function extractAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrList = el.attributes;
  if (!attrList) return attrs;

  for (let i = 0; i < attrList.length; i++) {
    const attr = attrList[i];
    if (attr && attr.name && attr.value !== undefined) {
      attrs[attr.name] = attr.value;
    }
  }

  return attrs;
}

// ─── VIEWBOX PARSING ─────────────────────────────────────────────

function parseViewBox(
  attr: string | null
): { x: number; y: number; width: number; height: number } | null {
  if (!attr) return null;

  const parts = attr.trim().split(/[\s,]+/).map(Number);
  if (parts.length < 4 || parts.some(isNaN)) return null;

  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

// ─── UNIT CONVERSION ─────────────────────────────────────────────

/**
 * SVG units → mm conversion factors.
 * SVG spec default: 1px = 1/96 inch. Our scene uses mm.
 */
const SVG_UNIT_TO_MM: Record<string, number> = {
  'mm': 1,
  'cm': 10,
  'in': 25.4,
  'pt': 25.4 / 72,    // 1pt = 1/72 inch
  'pc': 25.4 / 6,     // 1pc = 1/6 inch
  'px': 25.4 / 96,    // 1px = 1/96 inch (CSS/SVG default)
  '':   1,             // No unit = mm (laser tool convention, differs from SVG spec px default)
};

export interface ParsedLength {
  value: number;
  unit: string;
  mm: number;          // Value converted to mm
}

/**
 * Parse an SVG length attribute like "200mm", "500px", "8in", or "300".
 * Returns null for missing/invalid values.
 */
export function parseLength(attr: string | null): ParsedLength | null {
  if (!attr) return null;

  const match = attr.trim().match(/^([+-]?[\d.]+(?:[eE][+-]?\d+)?)\s*(mm|cm|in|pt|pc|px|%)?$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (isNaN(value)) return null;

  const unit = match[2] || '';

  // Percentage is not supported as absolute length
  if (unit === '%') return null;

  const factor = SVG_UNIT_TO_MM[unit] ?? SVG_UNIT_TO_MM[''];
  return { value, unit, mm: value * factor };
}

/**
 * Parse a length and return just the mm value, or null.
 */
export function parseLengthMm(attr: string | null): number | null {
  const parsed = parseLength(attr);
  return parsed ? parsed.mm : null;
}

/**
 * Detect the dominant unit system of an SVG.
 * Returns 'mm' if dimensions use mm/cm/in, 'px' otherwise.
 */
export function detectSvgUnits(
  widthAttr: string | null,
  heightAttr: string | null
): 'mm' | 'px' {
  const w = parseLength(widthAttr);
  const h = parseLength(heightAttr);

  // Explicit px suffix = pixel mode
  if (w && w.unit === 'px') return 'px';
  if (h && h.unit === 'px') return 'px';

  // Everything else (mm, cm, in, no suffix) = mm mode
  return 'mm';
}
