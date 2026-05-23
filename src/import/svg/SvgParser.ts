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
import { assertSvgLimit, bumpAndAssert, emptyParseContext, type SvgParseContext } from './SvgComplexityLimits';
// T1-158: pure parser helpers (viewBox parser, attribute snapshot,
// unsupported-feature message builder) extracted to a sibling module.
import {
  extractAttributes,
  parseViewBox,
  unsupportedFeatureMessage,
} from './svgParserHelpers';

// ─── PUBLIC TYPES ────────────────────────────────────────────────

export interface SvgElement {
  tag: string;                     // 'rect', 'circle', 'path', etc.
  attrs: Record<string, string>;   // Raw attribute values
  worldTransform: Matrix3x2;       // Accumulated transform (groups × own)
  computedStyle: SvgComputedStyle; // Inherited presentation style at flatten time
}

export type SvgImportWarningCode =
  | 'SVG_TEXT_SKIPPED'
  | 'SVG_FEATURE_UNSUPPORTED'
  | 'SVG_PATH_MALFORMED'
  | 'SVG_RENDERABILITY_SKIPPED';

export interface SvgComputedStyle {
  stroke?: string;
  fill?: string;
  strokeWidth?: string;
  display?: string;
  visibility?: string;
  opacity?: string;
  strokeOpacity?: string;
  fillOpacity?: string;
  clipPath?: string;
  mask?: string;
}

export interface SvgImportWarning {
  code: SvgImportWarningCode;
  count: number;
  message: string;
  feature?: string;
  examples?: string[];
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
  warnings: SvgImportWarning[];
  viewBox: { x: number; y: number; width: number; height: number } | null;
  widthMm: number;         // Physical width in mm
  heightMm: number;        // Physical height in mm
  svgUnits: 'mm' | 'px';  // Detected unit system
}

const EMPTY_RESULT: SvgParseResult = {
  elements: [], warnings: [], viewBox: null, widthMm: 400, heightMm: 400, svgUnits: 'px',
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
  assertSvgLimit('MAX_BYTES', svgString.length);

  const unitMode: SvgUnitMode = options?.unitMode ?? 'laser';

  // T1-185 (internal audit F-048): the `any` here documents a real
  // type-system limitation, not a sloppy cast. `DOMParser` is
  // available in both browser (lib.dom) and Node test environments
  // (via `@xmldom/xmldom`). Their Document / Element types share
  // a duck-typed subset (getElementsByTagName, getAttribute,
  // childNodes) used by the SVG walkers below, but the two type
  // libraries declare structurally-incompatible shapes (lib.dom
  // Element has classList/clientHeight/etc. that xmldom does not).
  // Casting through `any` lets the runtime-compatible subset flow
  // through both code paths. Pre-T1-185 this had no comment; the
  // audit asked for cleanup but the constraint is structural.
  let doc: any;
  try {
    doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
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
  const textSkips: SvgTextSkipReport = { count: 0, examples: [] };
  const renderabilitySkips: SvgRenderabilitySkipReport = { count: 0, examples: [] };
  const context = emptyParseContext();
  const definitions = collectSvgDefinitions(svgRoot);
  const cssRules = collectSvgStyleRules(svgRoot);
  const rootStyle = mergeSvgStyles({}, svgRoot, cssRules);
  const unsupportedFeatures = collectUnsupportedFeatures(svgRoot);
  traverse(svgRoot, rootTransform, rootStyle, elements, context, 0, 0, textSkips, renderabilitySkips, definitions, cssRules, []);

  return {
    elements,
    warnings: buildSvgWarnings(textSkips, unsupportedFeatures, renderabilitySkips),
    viewBox,
    widthMm,
    heightMm,
    svgUnits,
  };
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

interface SvgTextSkipReport {
  count: number;
  examples: string[];
}

interface SvgRenderabilitySkipReport {
  count: number;
  examples: string[];
}

interface SvgUnsupportedFeatureReport {
  feature: string;
  count: number;
  examples: string[];
}

interface SvgCssRule {
  selector: string;
  style: SvgComputedStyle;
  specificity: number;
  order: number;
}

function traverse(
  node: Element,
  parentTransform: Matrix3x2,
  parentStyle: SvgComputedStyle,
  output: SvgElement[],
  context: SvgParseContext,
  depth: number,
  transformDepth: number,
  textSkips: SvgTextSkipReport,
  renderabilitySkips: SvgRenderabilitySkipReport,
  definitions: Map<string, Element>,
  cssRules: readonly SvgCssRule[],
  useStack: readonly string[],
): void {
  const childNodes = node.childNodes;
  if (!childNodes) return;

  for (let i = 0; i < childNodes.length; i++) {
    const child = childNodes[i] as Element;
    visitSvgElement(
      child,
      parentTransform,
      parentStyle,
      output,
      context,
      depth,
      transformDepth,
      textSkips,
      renderabilitySkips,
      definitions,
      cssRules,
      useStack,
    );
  }
}

function visitSvgElement(
  child: Element,
  parentTransform: Matrix3x2,
  parentStyle: SvgComputedStyle,
  output: SvgElement[],
  context: SvgParseContext,
  depth: number,
  transformDepth: number,
  textSkips: SvgTextSkipReport,
  renderabilitySkips: SvgRenderabilitySkipReport,
  definitions: Map<string, Element>,
  cssRules: readonly SvgCssRule[],
  useStack: readonly string[],
): void {
  if (!child.tagName) return;  // Skip text nodes

  context.nodeCount = bumpAndAssert(context.nodeCount, 'MAX_NODES');
  const childDepth = depth + 1;
  assertSvgLimit('MAX_DEPTH', childDepth);

  const tag = child.tagName.toLowerCase().replace(/^svg:/, '');
  const transformAttr = child.getAttribute('transform');
  const childTransformDepth = transformAttr ? transformDepth + 1 : transformDepth;
  assertSvgLimit('MAX_TRANSFORM_DEPTH', childTransformDepth);
  context.depth = childDepth;
  context.transformDepth = childTransformDepth;

  const ownTransform = parseTransform(transformAttr);
  const worldTransform = multiplyMatrix(parentTransform, ownTransform);
  const computedStyle = mergeSvgStyles(parentStyle, child, cssRules);

  if (tag === 'defs') {
    return;
  }

  if (isSubtreeBlockedFromOutput(computedStyle)) {
    recordRenderabilitySkip(child, renderabilitySkips);
    return;
  }

  if (tag === 'g' || tag === 'svg' || tag === 'symbol') {
    // Group: recurse with accumulated transform
    traverse(
      child,
      worldTransform,
      computedStyle,
      output,
      context,
      childDepth,
      childTransformDepth,
      textSkips,
      renderabilitySkips,
      definitions,
      cssRules,
      useStack,
    );
  } else if (tag === 'use') {
    resolveUseElement(
      child,
      worldTransform,
      computedStyle,
      output,
      context,
      childDepth,
      childTransformDepth,
      textSkips,
      renderabilitySkips,
      definitions,
      cssRules,
      useStack,
    );
  } else if (tag === 'text') {
    recordTextSkip(child, textSkips);
  } else if (RENDERABLE_TAGS.has(tag)) {
    if (!isRenderableElementOutputVisible(tag, computedStyle)) {
      recordRenderabilitySkip(child, renderabilitySkips);
      return;
    }
    // Renderable element: extract attributes
    context.renderableCount = bumpAndAssert(context.renderableCount, 'MAX_RENDERABLE');
    const attrs = extractAttributes(child);
    output.push({ tag, attrs, worldTransform, computedStyle: { ...computedStyle } });
  }
  // Skip: style, clipPath, mask, etc.
}

function resolveUseElement(
  useNode: Element,
  useTransform: Matrix3x2,
  useStyle: SvgComputedStyle,
  output: SvgElement[],
  context: SvgParseContext,
  depth: number,
  transformDepth: number,
  textSkips: SvgTextSkipReport,
  renderabilitySkips: SvgRenderabilitySkipReport,
  definitions: Map<string, Element>,
  cssRules: readonly SvgCssRule[],
  useStack: readonly string[],
): void {
  const refId = getUseReferenceId(useNode);
  if (!refId || useStack.includes(refId)) return;
  const referenced = definitions.get(refId);
  if (!referenced) return;

  const translatedTransform = multiplyMatrix(useTransform, positionTransformForUseElement(useNode));
  visitSvgElement(
    referenced,
    translatedTransform,
    useStyle,
    output,
    context,
    depth,
    transformDepth,
    textSkips,
    renderabilitySkips,
    definitions,
    cssRules,
    [...useStack, refId],
  );
}

function collectSvgDefinitions(root: Element): Map<string, Element> {
  const definitions = new Map<string, Element>();

  function visit(node: Element): void {
    if (!node.tagName) return;
    const id = node.getAttribute('id');
    if (id) definitions.set(id, node);
    const childNodes = node.childNodes;
    if (!childNodes) return;
    for (let i = 0; i < childNodes.length; i++) {
      visit(childNodes[i] as Element);
    }
  }

  visit(root);
  return definitions;
}

function collectUnsupportedFeatures(root: Element): SvgUnsupportedFeatureReport[] {
  const reports = new Map<string, SvgUnsupportedFeatureReport>();

  function record(feature: string, example?: string | null): void {
    const report = reports.get(feature) || { feature, count: 0, examples: [] };
    report.count++;
    const cleaned = example?.replace(/\s+/g, ' ').trim();
    if (cleaned && report.examples.length < 3) report.examples.push(cleaned.slice(0, 80));
    reports.set(feature, report);
  }

  function visit(node: Element): void {
    if (!node.tagName) return;
    const tag = node.tagName.toLowerCase().replace(/^svg:/, '');
    const id = node.getAttribute('id');
    if (tag === 'clippath') record('clipPath', id ? `#${id}` : null);
    if (tag === 'mask') record('mask', id ? `#${id}` : null);
    if (tag === 'foreignobject') record('foreignObject', id ? `#${id}` : null);
    if (tag === 'style') {
      record('<style>', String((node as unknown as { textContent?: string }).textContent ?? ''));
    }
    const clipPath = node.getAttribute('clip-path');
    if (clipPath) record('clipPath', clipPath);
    const mask = node.getAttribute('mask');
    if (mask) record('mask', mask);

    const childNodes = node.childNodes;
    if (!childNodes) return;
    for (let i = 0; i < childNodes.length; i++) {
      visit(childNodes[i] as Element);
    }
  }

  visit(root);
  return [...reports.values()];
}

function collectSvgStyleRules(root: Element): SvgCssRule[] {
  const rules: SvgCssRule[] = [];
  let order = 0;

  function visit(node: Element): void {
    if (!node.tagName) return;
    const tag = node.tagName.toLowerCase().replace(/^svg:/, '');
    if (tag === 'style') {
      const css = String((node as unknown as { textContent?: string }).textContent ?? '');
      for (const rule of parseSimpleCssRules(css, order)) {
        rules.push(rule);
        order++;
      }
    }

    const childNodes = node.childNodes;
    if (!childNodes) return;
    for (let i = 0; i < childNodes.length; i++) {
      visit(childNodes[i] as Element);
    }
  }

  visit(root);
  return rules;
}

function parseSimpleCssRules(css: string, startOrder: number): SvgCssRule[] {
  const rules: SvgCssRule[] = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  let order = startOrder;
  while ((match = rulePattern.exec(css))) {
    const selectors = match[1]
      .split(',')
      .map(selector => selector.trim())
      .filter(Boolean);
    const declarations = match[2];
    for (const selector of selectors) {
      const specificity = simpleSelectorSpecificity(selector);
      if (specificity === null) continue;
      const style: SvgComputedStyle = {};
      applyStyleAttribute(style, declarations);
      if (Object.keys(style).length === 0) continue;
      rules.push({ selector, style, specificity, order });
      order++;
    }
  }
  return rules;
}

function simpleSelectorSpecificity(selector: string): number | null {
  const normalized = selector.trim();
  if (!normalized) return null;
  if (/[ >+~[:]/.test(normalized)) return null;
  if (/^#[A-Za-z_][\w:.-]*$/.test(normalized)) return 100;
  if (/^\.[A-Za-z_][\w:.-]*$/.test(normalized)) return 10;
  if (/^[A-Za-z_][\w:.-]*$/.test(normalized)) return 1;
  return null;
}

function cssRuleMatches(rule: SvgCssRule, node: Element): boolean {
  const selector = rule.selector.trim();
  if (selector.startsWith('#')) {
    return node.getAttribute('id') === selector.slice(1);
  }
  if (selector.startsWith('.')) {
    const wanted = selector.slice(1);
    return (node.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .includes(wanted);
  }
  const tag = node.tagName?.toLowerCase().replace(/^svg:/, '') ?? '';
  return tag === selector.toLowerCase();
}

function getUseReferenceId(node: Element): string | null {
  const raw = node.getAttribute('href')
    || node.getAttribute('xlink:href')
    || (node as unknown as { getAttributeNS?: (namespace: string, localName: string) => string | null })
      .getAttributeNS?.('http://www.w3.org/1999/xlink', 'href');
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('#')) return trimmed.slice(1);
  const urlMatch = trimmed.match(/^url\(#(.+)\)$/);
  return urlMatch ? urlMatch[1] : null;
}

function positionTransformForUseElement(node: Element): Matrix3x2 {
  return {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    tx: parseFloat(node.getAttribute('x') || '0') || 0,
    ty: parseFloat(node.getAttribute('y') || '0') || 0,
  };
}

function mergeSvgStyles(
  parentStyle: SvgComputedStyle,
  node: Element,
  cssRules: readonly SvgCssRule[] = [],
): SvgComputedStyle {
  const merged: SvgComputedStyle = { ...parentStyle };
  applyStyleValue(merged, 'stroke', node.getAttribute('stroke'));
  applyStyleValue(merged, 'fill', node.getAttribute('fill'));
  applyStyleValue(merged, 'strokeWidth', node.getAttribute('stroke-width'));
  applyStyleValue(merged, 'display', node.getAttribute('display'));
  applyStyleValue(merged, 'visibility', node.getAttribute('visibility'));
  applyStyleValue(merged, 'opacity', node.getAttribute('opacity'));
  applyStyleValue(merged, 'strokeOpacity', node.getAttribute('stroke-opacity'));
  applyStyleValue(merged, 'fillOpacity', node.getAttribute('fill-opacity'));
  applyStyleValue(merged, 'clipPath', node.getAttribute('clip-path'));
  applyStyleValue(merged, 'mask', node.getAttribute('mask'));
  applyMatchingCssRules(merged, node, cssRules);
  applyStyleAttribute(merged, node.getAttribute('style'));
  if (normalizedStyleValue(parentStyle.display) === 'none') merged.display = 'none';
  if (opacityValue(parentStyle.opacity, 1) <= 0) merged.opacity = '0';
  if (hasActiveUnsupportedClipOrMask(parentStyle.clipPath)) merged.clipPath = parentStyle.clipPath;
  if (hasActiveUnsupportedClipOrMask(parentStyle.mask)) merged.mask = parentStyle.mask;
  return merged;
}

function applyMatchingCssRules(
  target: SvgComputedStyle,
  node: Element,
  cssRules: readonly SvgCssRule[],
): void {
  const matchingRules = cssRules
    .filter(rule => cssRuleMatches(rule, node))
    .sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  for (const rule of matchingRules) {
    for (const [key, value] of Object.entries(rule.style) as [keyof SvgComputedStyle, string][]) {
      applyStyleValue(target, key, value);
    }
  }
}

function applyStyleAttribute(target: SvgComputedStyle, style: string | null): void {
  if (!style) return;
  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator === -1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1);
    if (property === 'stroke') applyStyleValue(target, 'stroke', value);
    if (property === 'fill') applyStyleValue(target, 'fill', value);
    if (property === 'stroke-width') applyStyleValue(target, 'strokeWidth', value);
    if (property === 'display') applyStyleValue(target, 'display', value);
    if (property === 'visibility') applyStyleValue(target, 'visibility', value);
    if (property === 'opacity') applyStyleValue(target, 'opacity', value);
    if (property === 'stroke-opacity') applyStyleValue(target, 'strokeOpacity', value);
    if (property === 'fill-opacity') applyStyleValue(target, 'fillOpacity', value);
    if (property === 'clip-path') applyStyleValue(target, 'clipPath', value);
    if (property === 'mask') applyStyleValue(target, 'mask', value);
  }
}

function applyStyleValue(
  target: SvgComputedStyle,
  key: keyof SvgComputedStyle,
  value: string | null,
): void {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === 'inherit') return;
  target[key] = normalized;
}

function isSubtreeBlockedFromOutput(style: SvgComputedStyle): boolean {
  if (normalizedStyleValue(style.display) === 'none') return true;
  if (opacityValue(style.opacity, 1) <= 0) return true;
  if (hasActiveUnsupportedClipOrMask(style.clipPath)) return true;
  if (hasActiveUnsupportedClipOrMask(style.mask)) return true;
  return false;
}

function isRenderableElementOutputVisible(tag: string, style: SvgComputedStyle): boolean {
  const visibility = normalizedStyleValue(style.visibility);
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  if (paintIsExplicitlyNonRendering(tag, style)) return false;
  return true;
}

function paintIsExplicitlyNonRendering(tag: string, style: SvgComputedStyle): boolean {
  const strokeSpecified = style.stroke != null || style.strokeOpacity != null;
  const fillSpecified = style.fill != null || style.fillOpacity != null;
  if (!strokeSpecified && !fillSpecified) return false;
  return !strokePaintIsVisible(style, strokeSpecified)
    && !fillPaintIsVisible(tag, style, fillSpecified);
}

function strokePaintIsVisible(style: SvgComputedStyle, strokeSpecified: boolean): boolean {
  if (!strokeSpecified) return false;
  const stroke = normalizedStyleValue(style.stroke);
  const strokeOpacity = opacityValue(style.strokeOpacity, 1);
  if (stroke === 'none' || strokeOpacity <= 0) return false;
  return true;
}

function fillPaintIsVisible(tag: string, style: SvgComputedStyle, fillSpecified: boolean): boolean {
  if (!fillSpecified) return false;
  if (!elementCanHaveVisibleFill(tag)) return false;
  const fill = normalizedStyleValue(style.fill);
  const fillOpacity = opacityValue(style.fillOpacity, 1);
  if (fill === 'none' || fillOpacity <= 0) return false;
  return true;
}

function elementCanHaveVisibleFill(tag: string): boolean {
  return tag !== 'line';
}

function hasActiveUnsupportedClipOrMask(value: string | undefined): boolean {
  const normalized = normalizedStyleValue(value);
  return Boolean(normalized && normalized !== 'none');
}

function normalizedStyleValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function opacityValue(value: string | undefined, fallback: number): number {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  const parsed = normalized.endsWith('%')
    ? Number.parseFloat(normalized.slice(0, -1)) / 100
    : Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function recordTextSkip(node: Element, report: SvgTextSkipReport): void {
  report.count++;
  const text = String((node as unknown as { textContent?: string }).textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text && report.examples.length < 3) {
    report.examples.push(text.slice(0, 80));
  }
}

function recordRenderabilitySkip(node: Element, report: SvgRenderabilitySkipReport): void {
  report.count++;
  const id = node.getAttribute('id');
  const label = node.getAttribute('inkscape:label');
  const tag = node.tagName?.toLowerCase().replace(/^svg:/, '') || 'element';
  const example = id ? `#${id}` : label ? label : tag;
  if (example && report.examples.length < 3) {
    report.examples.push(example.slice(0, 80));
  }
}

function buildSvgWarnings(
  textSkips: SvgTextSkipReport,
  unsupportedFeatures: SvgUnsupportedFeatureReport[],
  renderabilitySkips: SvgRenderabilitySkipReport,
): SvgImportWarning[] {
  const warnings: SvgImportWarning[] = [];
  if (textSkips.count > 0) {
    const noun = textSkips.count === 1 ? 'text element' : 'text elements';
    warnings.push({
      code: 'SVG_TEXT_SKIPPED',
      count: textSkips.count,
      message:
        `${textSkips.count} ${noun} skipped during SVG import. ` +
        'Convert text to outlines in your design tool before re-importing.',
      examples: textSkips.examples,
    });
  }

  if (renderabilitySkips.count > 0) {
    const noun = renderabilitySkips.count === 1 ? 'SVG element' : 'SVG elements';
    warnings.push({
      code: 'SVG_RENDERABILITY_SKIPPED',
      feature: 'renderability',
      count: renderabilitySkips.count,
      message:
        `${renderabilitySkips.count} non-rendering or unsafe ${noun} skipped during SVG import. ` +
        'Hidden, transparent, clipped, or masked artwork must be flattened before machine output.',
      examples: renderabilitySkips.examples,
    });
  }

  for (const report of unsupportedFeatures) {
    warnings.push({
      code: 'SVG_FEATURE_UNSUPPORTED',
      feature: report.feature,
      count: report.count,
      message: unsupportedFeatureMessage(report.feature, report.count),
      examples: report.examples,
    });
  }

  return warnings;
}

// T1-158: unsupportedFeatureMessage / extractAttributes / parseViewBox
// moved to ./svgParserHelpers.

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
