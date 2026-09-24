// parseSvg — full SVG → ImportedSvg pipeline.
//
// 1. Sanitize via DOMPurify (sanitize.ts) — strips <script>, foreign objects,
//    external xlink:href, non-image data URIs.
// 2. Parse the cleaned markup with the native DOMParser into a Document.
// 3. Walk every geometry-bearing element (shape-to-polylines.ts) in document
//    order — deterministic for snapshot tests.
// 4. Attribute each element to stroke color, falling back to visible fill
//    color for fill-only logo artwork. Colors cascade from presentation
//    attributes, <style> rules and the style attribute; an unset fill is
//    SVG's initial black. Elements that paint neither are skipped.
// 5. Bundle into an ImportedSvg with the SVG's viewBox as the natural bounds.

import {
  type ColoredPath,
  type CurveSubpath,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  polylineToCurveSubpath,
} from '../../core/scene';
import { type SvgStripCounts, sanitizeSvg } from './sanitize';
import { applySvgMatrix, transformSvgCurveSubpath } from './svg-curve-transform';
import { multiplySvgMatrix, translateSvgMatrix } from './svg-transform-attribute';
import { elementToSubPaths } from './shape-to-polylines';
import { createSvgIdResolver, type SvgIdResolver } from './svg-id-resolver';
import { linearScaleMagnitude } from './transform-scale';
import {
  assertSvgImportPoints,
  createSvgImportBudget,
  reserveSvgPolyline,
  svgImportSizeNote,
  type SvgImportBudget,
} from './svg-import-budget';
import { resolveUnitScale } from './svg-units';
import {
  INITIAL_PRESENTATION_STATE,
  normalizeColor,
  numAttr,
  presentationStateFor,
  type PresentationState,
} from './svg-presentation';
import type { ParsedSvgFragment, SvgImportEntry } from './svg-import-fragment';
import { svgImageElement } from './svg-image-element';
import { createSvgStyleCascade, type SvgStyleCascade } from './svg-stylesheet';

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
  readonly entries: SvgImportEntry[];
  readonly identity: { readonly id: string; readonly source: string };
  readonly counts: { text: number; image: number; fillAndStroke: number };
  readonly budget: SvgImportBudget;
  readonly resolveId: SvgIdResolver;
  readonly cascadeStyles: SvgStyleCascade;
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
    { ...INITIAL_PRESENTATION_STATE, transform },
    context.cascadeStyles,
  );
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
  const state = presentationStateFor(el, parent, context.cascadeStyles);
  const tag = el.tagName.toLowerCase();
  if (['text', 'tspan'].includes(tag)) {
    context.counts.text += 1;
  } else if (tag === 'image' && !state.hidden) {
    const image = svgImageElement(el, state, context.resolveId, {
      id: context.identity.id + '-' + context.entries.length,
      source: context.identity.source,
    });
    if (image === null) context.counts.image += 1;
    else context.entries.push(image);
  } else if (NEVER_RENDERED.has(tag)) {
    return;
  } else if (tag === 'use' && !state.hidden) {
    appendUseGeometry(el, state, context, depth);
  } else if (!state.hidden) {
    appendElementGeometry(el, state, context);
  }

  for (const child of Array.from(el.children)) {
    walkElement(child, state, context, depth + 1);
  }
}

function appendUseGeometry(
  el: Element,
  state: PresentationState,
  context: WalkContext,
  depth: number,
): void {
  const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
  if (href === null || !href.startsWith('#') || href.length <= 1) return;
  const referenced = context.resolveId(href.slice(1));
  if (referenced === null || referenced === el) return;
  const placedState = {
    ...state,
    transform: multiplySvgMatrix(
      state.transform,
      translateSvgMatrix(numAttr(el, 'x'), numAttr(el, 'y')),
    ),
  };
  if (isDefinitionContainer(referenced)) {
    walkReferencedDefinition(referenced, placedState, context, depth + 1);
    return;
  }
  walkElement(referenced, placedState, context, depth + 1);
}

// SVG's initial fill is black, so a shape that nothing styles still paints and
// imports exactly as an explicit fill="#000000" does. A <line> has no interior
// and is never filled (SVG 1.1 §9.5), so it still needs a stroke.
function visibleFillColor(el: Element, state: PresentationState): string {
  const initial = el.tagName.toLowerCase() === 'line' ? null : '#000000';
  return state.fillOpacity > 0 ? normalizeColor(state.fill ?? initial) : '';
}

function appendElementGeometry(el: Element, state: PresentationState, context: WalkContext): void {
  // Flatten curves/arcs to a scene-mm tolerance, not user-units, by dividing
  // the mm chord tolerance by this transform's distance stretch (audit C2).
  const t = state.transform;
  const subs = elementToSubPaths(el, linearScaleMagnitude(t.a, t.b, t.c, t.d));
  if (subs.length === 0) return;
  const strokeColor = state.strokeOpacity > 0 ? normalizeColor(state.stroke) : '';
  const fillColor = visibleFillColor(el, state);
  const color = strokeColor !== '' ? strokeColor : fillColor;
  if (color === '') return;
  recordVectorPresentation(state, context, strokeColor, fillColor);
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
  for (const sub of subs) {
    reserveSvgPolyline(color, sub.points.length, context.budget);
    const points = sub.points.map((p) => applySvgMatrix(state.transform, p));
    assertSvgImportPoints(points);
    const polyline = {
      points,
      closed: sub.closed,
    };
    bucket.polylines.push(polyline);
    entryPolylines.push(polyline);
    bucket.curves.push(
      sub.curve === undefined
        ? polylineToCurveSubpath(polyline)
        : transformSvgCurveSubpath(sub.curve, state.transform),
    );
    const curve = bucket.curves.at(-1);
    if (curve !== undefined) entryCurves.push(curve);
  }
  appendVectorEntry(
    context,
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

function recordVectorPresentation(
  state: PresentationState,
  context: WalkContext,
  strokeColor: string,
  fillColor: string,
): void {
  if (state.clips.length > 0) {
    throw new Error(
      'SVG vector clipping is not supported. Apply the clip to the paths before importing.',
    );
  }
  if (state.unsupportedEffects.length > 0) {
    throw new Error(
      'SVG vector masks and filters are not supported. Apply these effects before importing.',
    );
  }
  if (strokeColor !== '' && fillColor !== '') context.counts.fillAndStroke += 1;
}

function isDefinitionContainer(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === 'defs' || tag === 'symbol';
}

function walkReferencedDefinition(
  el: Element,
  parent: PresentationState,
  context: WalkContext,
  depth: number,
): void {
  const state = presentationStateFor(el, parent, context.cascadeStyles);
  for (const child of Array.from(el.children)) {
    walkElement(child, state, context, depth + 1);
  }
}

export function parseSvg(args: { svgText: string; id: string; source: string }): ParseSvgResult {
  const { clean, stripped } = sanitizeSvg(args.svgText);

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
  const counts = { text: 0, image: 0, fillAndStroke: 0 };
  const budget = createSvgImportBudget();
  const entries: SvgImportEntry[] = [];
  const cascadeStyles = createSvgStyleCascade(svgEl);
  walkGeometry(
    svgEl,
    {
      byColor,
      counts,
      budget,
      entries,
      identity: args,
      resolveId: createSvgIdResolver(svgEl),
      cascadeStyles,
    },
    unitScale,
  );

  const paths: ColoredPath[] = [...byColor.values()].map((bucket) => ({
    color: bucket.color,
    ...(bucket.fillRule === undefined ? {} : { fillRule: bucket.fillRule }),
    polylines: bucket.polylines,
    curves: bucket.curves,
  }));

  const notes: string[] = [];
  if (entries.length === 0) notes.push('SVG has no drawable geometry');
  // Rule 7 / ADR-268: this used to THROW mid-walk once the polyline/point/color
  // ceilings were crossed. It now reports the same measurement and imports.
  const sizeNote = svgImportSizeNote(budget);
  if (sizeNote !== null) notes.push(sizeNote);
  if (counts.text > 0) {
    notes.push(`Ignored ${counts.text} text element(s) — convert to paths or wait for Phase D`);
  }
  if (counts.image > 0) {
    notes.push(`Ignored ${counts.image} image element(s) — Phase E adds raster tracing`);
  }
  if (counts.fillAndStroke > 0) {
    notes.push(
      `SVG presentation: Imported ${counts.fillAndStroke} SVG element(s) as strokes only; their fills were omitted.`,
    );
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
    fragment: { source: args.source, bounds, entries },
    stripped,
    notes,
    ignoredTextElements: counts.text,
    ignoredImageElements: counts.image,
  };
}

function boundsForPolylines(polylines: readonly Polyline[]): ImportedSvg['bounds'] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const line of polylines)
    for (const point of line.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  return { minX, minY, maxX, maxY };
}

function appendVectorEntry(context: WalkContext, path: ColoredPath, filled: boolean): void {
  const mode = filled ? 'fill' : 'line';
  const entryPath = filled ? svgFillPath(path) : path;
  const bounds = boundsForPolylines(path.polylines);
  const previous = context.entries.at(-1);
  if (previous?.kind === 'imported-svg' && previous.operationOverride?.mode === mode) {
    context.entries[context.entries.length - 1] = {
      ...previous,
      paths: [...previous.paths, entryPath],
      bounds: {
        minX: Math.min(previous.bounds.minX, bounds.minX),
        minY: Math.min(previous.bounds.minY, bounds.minY),
        maxX: Math.max(previous.bounds.maxX, bounds.maxX),
        maxY: Math.max(previous.bounds.maxY, bounds.maxY),
      },
    };
    return;
  }
  context.entries.push({
    kind: 'imported-svg',
    id: context.identity.id + '-' + context.entries.length,
    source: context.identity.source,
    bounds,
    transform: IDENTITY_TRANSFORM,
    operationOverride: { mode },
    paths: [entryPath],
  });
}

function svgFillPath(path: ColoredPath): ColoredPath {
  // SVG fills implicitly close every subpath and default to nonzero winding.
  // Materialize both meanings only in the new Fill fragment, keeping stroke
  // geometry and the legacy aggregate (including its saved-project defaults).
  return {
    ...path,
    fillRule: path.fillRule ?? 'nonzero',
    polylines: path.polylines.map((line) => ({ ...line, closed: true })),
    ...(path.curves === undefined
      ? {}
      : { curves: path.curves.map((curve) => ({ ...curve, closed: true })) }),
  };
}
