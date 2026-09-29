// parseSvg — full SVG → ImportedSvg pipeline.
//
// 1. Sanitize via DOMPurify (sanitize.ts) — strips <script>, foreign objects,
//    external xlink:href, non-image data URIs.
// 2. Parse the cleaned markup with the native DOMParser into a Document.
// 3. Walk every geometry-bearing element (shape-to-polylines.ts) in document
//    order — deterministic for snapshot tests. Nested <svg> and <symbol>
//    viewports map their content (not clipped to the viewport), a <switch>
//    renders one child, and <use> expansion skips circular references and has
//    a budget (ADR-268 Amendment 1).
// 4. Attribute each element to stroke color, falling back to visible fill
//    color for fill-only logo artwork. Colors cascade from presentation
//    attributes, <style> rules and the style attribute; an unset fill is
//    SVG's initial black. Elements that paint neither are skipped. A gradient
//    paints its first visible stop's colour; a pattern paint is skipped.
// 5. Keep only what each element's clip paths keep (svg-vector-clip-geometry.ts);
//    masks and filters are left out and disclosed (ADR-358 Amendment 2).
// 6. Bundle into an ImportedSvg with the SVG's viewBox as the natural bounds.

import {
  type ColoredPath,
  type CurveSubpath,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
} from '../../core/scene';
import { expandInternalSubset } from '../xml/internal-subset-entities';
import { type SvgStripCounts, sanitizeSvg } from './sanitize';
import { multiplySvgMatrix, translateSvgMatrix } from './svg-transform-attribute';
import { elementToSubPaths } from './shape-to-polylines';
import { createSvgIdResolver, type SvgIdResolver } from './svg-id-resolver';
import { createSvgClipResolver, type SvgClipResolver } from './svg-clip-resolve';
import { createSvgVectorClipper, type SvgVectorClipper } from './svg-vector-clip-geometry';
import { linearScaleMagnitude } from './transform-scale';
import {
  assertSvgImportPoints,
  createSvgImportBudget,
  reserveSvgPolyline,
  type SvgImportBudget,
} from './svg-import-budget';
import { resolveUnitScale } from './svg-units';
import {
  INITIAL_PRESENTATION_STATE,
  numAttr,
  presentationStateFor,
  type PresentationState,
} from './svg-presentation';
import { BLACK_PAINT, NO_PAINT } from './svg-paint';
import {
  createSvgPaintResolver,
  type ResolvedSvgPaint,
  type SvgPaintResolver,
} from './svg-paint-server';
import { createSvgImportCounts, svgImportNotes, type SvgImportCounts } from './svg-import-notes';
import type { ParsedSvgFragment } from './svg-import-fragment';
import { appendVectorEntry, createSvgEntryList, type SvgEntryList } from './svg-import-entries';
import { svgImageElement } from './svg-image-element';
import { createSvgStyleCascade, type SvgStyleCascade } from './svg-stylesheet';
import { svgRenderedChildren } from './svg-conditional-processing';
import { hasSvgMarkers } from './svg-markers';
import { rootViewportSize, svgViewportTransform, viewportLength } from './svg-viewport';
import {
  createSvgUseBudget,
  spendSvgUseElement,
  svgUseTarget,
  type SvgUseBudget,
} from './svg-use-expansion';

export { SVG_IMPORT_LIMITS } from './svg-import-budget';

export type ParseSvgResult = {
  readonly object: ImportedSvg | null;
  readonly fragment?: ParsedSvgFragment;
  readonly stripped: SvgStripCounts;
  readonly notes: ReadonlyArray<string>;
  readonly ignoredTextElements: number;
  readonly ignoredImageElements: number;
};

type PathBucket = {
  readonly color: string;
  readonly fillRule: ColoredPath['fillRule'];
  readonly polylines: Polyline[];
  readonly curves: CurveSubpath[];
};

// Everything the walk carries besides the element and its inherited state.
// Bundled so the id resolver reaches <use> expansion without pushing the
// recursive walkers past the project's parameter-count limit.
type WalkContext = {
  readonly byColor: Map<string, PathBucket>;
  readonly fragment: SvgEntryList;
  readonly counts: SvgImportCounts;
  readonly budget: SvgImportBudget;
  readonly resolveId: SvgIdResolver;
  readonly cascadeStyles: SvgStyleCascade;
  readonly clipResolver: SvgClipResolver;
  readonly clipVector: SvgVectorClipper;
  readonly resolvePaint: SvgPaintResolver;
  /** Elements the walk is inside, through the document or through <use>. */
  readonly active: Set<Element>;
  readonly useBudget: SvgUseBudget;
};

function walkGeometry(
  svgEl: Element,
  context: WalkContext,
  unitScale: { readonly scaleX: number; readonly scaleY: number },
): void {
  // The unit scale seeds the transform stack root so every element's
  // geometry lands in mm (H9), composing with element/group transforms.
  const transform = { a: unitScale.scaleX, b: 0, c: 0, d: unitScale.scaleY, e: 0, f: 0 };
  const rootState = presentationStateFor(
    svgEl,
    { ...INITIAL_PRESENTATION_STATE, transform, viewport: rootViewportSize(svgEl) },
    context.cascadeStyles,
  );
  // The root is an ancestor of everything, so a <use> of it is circular.
  context.active.add(svgEl);
  for (const child of Array.from(svgEl.children)) {
    walkElement(child, rootState, context, 0);
  }
}

// Recursion-depth cap for the element walk. A circular <use> chain
// (<use href="#b"/> + <use href="#a"/>) recurses without bound and overflows the
// stack; this also caps pathologically deep nesting. 256 is far beyond any real
// SVG's nesting depth (security audit 2026-06-14).
const MAX_WALK_DEPTH = 256;

// Containers whose children never render in place: definitions paint only
// through <use>, and clip paths, masks, markers and patterns only through the
// property that references them. Walked as artwork, an unstyled clip rectangle
// would import with SVG's initial black fill.
const NEVER_RENDERED = new Set(['defs', 'symbol', 'clippath', 'mask', 'marker', 'pattern']);

function walkElement(
  el: Element,
  parent: PresentationState,
  context: WalkContext,
  depth: number,
): void {
  if (depth > MAX_WALK_DEPTH) return;
  if (context.useBudget.nesting > 0) spendSvgUseElement(context.useBudget);
  const state = presentationStateFor(el, parent, context.cascadeStyles);
  const tag = el.tagName.toLowerCase();
  // Text is not imported; a <text> counts once, however many <tspan>s it holds.
  if (tag === 'text') context.counts.text += 1;
  if (tag === 'text' || NEVER_RENDERED.has(tag)) return;
  appendElement(el, state, context, depth);
  const content = tag === 'svg' ? viewportState(el, state, AUTO_SIZE) : state;
  if (content !== null) walkChildren(el, content, context, depth);
}

function appendElement(
  el: Element,
  state: PresentationState,
  context: WalkContext,
  depth: number,
): void {
  const tag = el.tagName.toLowerCase();
  // A <use> paints nothing itself; visibility reaches its instance only by
  // inheritance, which the instance's own elements can override.
  if (tag === 'use') {
    if (!state.hiddenSubtree) appendUseGeometry(el, state, context, depth);
  } else if (!state.hidden) {
    if (tag === 'image') appendImage(el, state, context);
    else appendElementGeometry(el, state, context);
  }
}

function walkChildren(
  el: Element,
  state: PresentationState,
  context: WalkContext,
  depth: number,
): void {
  context.active.add(el);
  for (const child of svgRenderedChildren(el)) {
    walkElement(child, state, context, depth + 1);
  }
  context.active.delete(el);
}

type UseSize = { readonly width: number | null; readonly height: number | null };
const AUTO_SIZE: UseSize = { width: null, height: null };

// A nested <svg>, or the <svg> a <use> makes of a <symbol>, maps its content
// into its viewport; null when a zero size disables rendering. Content that
// overflows the viewport is not clipped to it.
function viewportState(
  el: Element,
  state: PresentationState,
  size: UseSize,
): PresentationState | null {
  const viewport = svgViewportTransform(el, state.viewport, size);
  if (viewport === null) return null;
  return {
    ...state,
    transform: multiplySvgMatrix(state.transform, viewport.matrix),
    viewport: viewport.viewport,
  };
}

function appendImage(el: Element, state: PresentationState, context: WalkContext): void {
  const { entries, identity } = context.fragment;
  const image = svgImageElement(el, state, context.clipResolver, {
    id: identity.id + '-' + entries.length,
    source: identity.source,
  });
  if (image.kind === 'svg-image') entries.push(image);
  else if (image.reason === 'no-data') context.counts.image += 1;
  else context.counts.skippedImages[image.reason] += 1;
}

function appendUseGeometry(
  el: Element,
  state: PresentationState,
  context: WalkContext,
  depth: number,
): void {
  const referenced = svgUseTarget(el, context.resolveId, context.active);
  if (referenced === 'circular') context.counts.circularUse += 1;
  if (referenced === null || referenced === 'circular') return;
  const placedState = {
    ...state,
    transform: multiplySvgMatrix(
      state.transform,
      translateSvgMatrix(numAttr(el, 'x'), numAttr(el, 'y')),
    ),
  };
  context.active.add(el);
  context.useBudget.nesting += 1;
  if (['defs', 'symbol', 'svg'].includes(referenced.tagName.toLowerCase())) {
    // The <use> element's width and height size the viewport of the <symbol>
    // or <svg> it instantiates.
    const size = {
      width: viewportLength(el, 'width', state.viewport.width),
      height: viewportLength(el, 'height', state.viewport.height),
    };
    walkReferencedDefinition(referenced, placedState, context, depth + 1, size);
  } else {
    walkElement(referenced, placedState, context, depth + 1);
  }
  context.useBudget.nesting -= 1;
  context.active.delete(el);
}

const UNPAINTED: ResolvedSvgPaint = { color: '', server: null };

// SVG's initial fill is black, so a shape that nothing styles still paints and
// imports exactly as an explicit fill="#000000" does. A <line> has no interior
// and is never filled (SVG 1.1 §9.5), so it still needs a stroke.
function visibleFill(
  el: Element,
  state: PresentationState,
  context: WalkContext,
): ResolvedSvgPaint {
  if (state.fillOpacity <= 0) return UNPAINTED;
  const initial = el.tagName.toLowerCase() === 'line' ? NO_PAINT : BLACK_PAINT;
  return context.resolvePaint(state.fill ?? initial, state.color);
}

function visibleStroke(state: PresentationState, context: WalkContext): ResolvedSvgPaint {
  if (state.strokeOpacity <= 0 || state.strokeWidthZero) return UNPAINTED;
  return context.resolvePaint(state.stroke ?? NO_PAINT, state.color);
}

function appendElementGeometry(el: Element, state: PresentationState, context: WalkContext): void {
  // Flatten curves/arcs to a scene-mm tolerance, not user-units, by dividing
  // the mm chord tolerance by this transform's distance stretch (audit C2).
  const t = state.transform;
  const subs = elementToSubPaths(el, linearScaleMagnitude(t.a, t.b, t.c, t.d));
  if (subs.length === 0) return;
  const stroke = visibleStroke(state, context);
  const fill = visibleFill(el, state, context);
  // A pattern paint is lost whichever paint the element imports with.
  if (stroke.server === 'pattern' || fill.server === 'pattern') context.counts.pattern += 1;
  const strokeColor = stroke.color;
  const fillColor = fill.color;
  const color = strokeColor !== '' ? strokeColor : fillColor;
  if (color === '') return;
  // Stroked artwork is cut as lines, so its clip trims lines; fills clip as areas.
  const geometry = context.clipVector(subs, state, strokeColor === '' ? 'fill' : 'line');
  if (geometry.polylines.length === 0) return;
  recordVectorPresentation(el, state, context, { stroke, fill });
  // Explicit SVG rules apply to each element's compound path. Different
  // elements paint independently even when their colours/rules match.
  const key = state.fillRule === undefined ? color : `${color}:${context.byColor.size}`;
  const bucket = context.byColor.get(key) ?? {
    color,
    fillRule: state.fillRule,
    polylines: [],
    curves: [],
  };
  const entryPolylines: Polyline[] = [];
  const entryCurves: CurveSubpath[] = [];
  geometry.polylines.forEach((polyline, index) => {
    reserveSvgPolyline(color, polyline.points.length, context.budget);
    assertSvgImportPoints(polyline.points);
    const curve = geometry.curves[index];
    if (curve === undefined) return;
    bucket.polylines.push(polyline);
    entryPolylines.push(polyline);
    bucket.curves.push(curve);
    entryCurves.push(curve);
  });
  appendVectorEntry(
    context.fragment,
    {
      color,
      ...(state.fillRule === undefined ? {} : { fillRule: state.fillRule }),
      polylines: entryPolylines,
      curves: entryCurves,
    },
    strokeColor === '',
  );
  context.byColor.set(key, bucket);
}

// Masks, filters, gradients and markers are imported without their effect
// and disclosed: the geometry they apply to is exact, and what they hide,
// soften, shade or add is not cut geometry KerfDesk can derive (ADR-358
// Amendment 2).
function recordVectorPresentation(
  el: Element,
  state: PresentationState,
  context: WalkContext,
  paint: { readonly stroke: ResolvedSvgPaint; readonly fill: ResolvedSvgPaint },
): void {
  const { counts } = context;
  if (state.unsupportedEffects.includes('mask')) counts.masked += 1;
  if (state.unsupportedEffects.includes('filter')) counts.filtered += 1;
  if (paint.stroke.color !== '' && paint.fill.color !== '') counts.fillAndStroke += 1;
  const imported = paint.stroke.color !== '' ? paint.stroke : paint.fill;
  if (imported.server === 'gradient') counts.gradient += 1;
  if (hasSvgMarkers(el, state.markers, context.resolveId)) counts.markers += 1;
}

function walkReferencedDefinition(
  el: Element,
  parent: PresentationState,
  context: WalkContext,
  depth: number,
  size: UseSize,
): void {
  spendSvgUseElement(context.useBudget);
  const state = presentationStateFor(el, parent, context.cascadeStyles);
  const content = el.tagName.toLowerCase() === 'defs' ? state : viewportState(el, state, size);
  if (content !== null) walkChildren(el, content, context, depth);
}

export function parseSvg(args: { svgText: string; id: string; source: string }): ParseSvgResult {
  // DOMPurify parses as HTML, which cannot read a DOCTYPE's internal subset.
  const { clean, stripped } = sanitizeSvg(expandInternalSubset(args.svgText));

  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  return parseSvgDocument(doc, args, stripped);
}

export function parseSvgDocument(
  doc: Document,
  args: { readonly id: string; readonly source: string },
  stripped: SvgStripCounts,
): ParseSvgResult {
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
  const byColor = new Map<string, PathBucket>();
  const counts = createSvgImportCounts();
  const budget = createSvgImportBudget();
  const fragment = createSvgEntryList(args);
  const cascadeStyles = createSvgStyleCascade(svgEl);
  const resolveId = createSvgIdResolver(svgEl);
  const clipResolver = createSvgClipResolver(resolveId, cascadeStyles);
  walkGeometry(
    svgEl,
    {
      byColor,
      counts,
      budget,
      fragment,
      resolveId,
      cascadeStyles,
      clipResolver,
      clipVector: createSvgVectorClipper(clipResolver),
      resolvePaint: createSvgPaintResolver(resolveId, cascadeStyles),
      active: new Set(),
      useBudget: createSvgUseBudget(svgEl),
    },
    unitScale,
  );

  const paths: ColoredPath[] = [...byColor.values()].map((bucket) => ({
    color: bucket.color,
    ...(bucket.fillRule === undefined ? {} : { fillRule: bucket.fillRule }),
    polylines: bucket.polylines,
    curves: bucket.curves,
  }));
  const { entries } = fragment;
  const notes = svgImportNotes(entries.length, budget, counts);

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
    fragment: { source: args.source, bounds, entries },
    stripped,
    notes,
    ignoredTextElements: counts.text,
    ignoredImageElements: counts.image,
  };
}
