import type { ColoredPath } from '../../core/scene';
import type { SvgMatrix } from './svg-curve-transform';
import { multiplySvgMatrix, parseSvgTransform } from './svg-transform-attribute';
import { inheritedSvgFillRule } from './svg-fill-rule';
import {
  BLACK_PAINT,
  parseSvgPaint,
  resolveSvgColorProperty,
  type SvgColorValue,
  type SvgPaint,
} from './svg-paint';
import { NO_MARKERS, svgMarkerReferences, type SvgMarkerReferences } from './svg-markers';
import type { SvgStyleCascade } from './svg-stylesheet';
import type { SvgViewportSize } from './svg-viewport';

// `element` carries the clip-path property; objectBoundingBox clips measure it.
export type SvgClipReference = {
  readonly id: string;
  readonly transform: SvgMatrix;
  readonly element: Element;
};

export type PresentationState = {
  /** null while unset: SVG's initial stroke is none. */
  readonly stroke: SvgPaint | null;
  /** null while unset: SVG's initial fill is black, and a line has no interior. */
  readonly fill: SvgPaint | null;
  /** The computed `color` property, which currentColor paints with. */
  readonly color: SvgColorValue;
  readonly fillRule: ColoredPath['fillRule'];
  readonly transform: SvgMatrix;
  readonly unsupportedEffects: readonly string[];
  readonly clips: readonly SvgClipReference[];
  /** display:none or zero opacity: nothing inside renders, whatever it says. */
  readonly hiddenSubtree: boolean;
  /** This element paints nothing: its subtree is hidden, or its visibility is. */
  readonly hidden: boolean;
  readonly opacity: number;
  readonly strokeOpacity: number;
  readonly fillOpacity: number;
  /** The computed visibility keyword; null until something sets it (visible). */
  readonly visibility: string | null;
  /** A zero stroke-width paints no stroke (SVG 2 painting.html#StrokeWidth). */
  readonly strokeWidthZero: boolean;
  readonly markers: SvgMarkerReferences;
  /** The viewport that percentage lengths resolve against. */
  readonly viewport: SvgViewportSize;
};

const IDENTITY_MATRIX: SvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const INITIAL_PRESENTATION_STATE: PresentationState = {
  stroke: null,
  fill: null,
  color: BLACK_PAINT,
  fillRule: undefined,
  transform: IDENTITY_MATRIX,
  clips: [],
  unsupportedEffects: [],
  hiddenSubtree: false,
  hidden: false,
  opacity: 1,
  strokeOpacity: 1,
  fillOpacity: 1,
  visibility: null,
  strokeWidthZero: false,
  markers: NO_MARKERS,
  viewport: { width: 100, height: 100 },
};

export function presentationStateFor(
  el: Element,
  parent: PresentationState,
  cascadeStyles: SvgStyleCascade,
): PresentationState {
  // Parsed once and passed down: each of the eight lookups below used to re-read
  // and re-split the whole style attribute for the same element. Matching
  // <style> rules merge in here, so paint, opacity, clips and effects all see
  // the winning declaration while retaining the fragment's ownership state.
  const styles = svgPresentationStyles(el, cascadeStyles);
  const color = resolveSvgColorProperty(specifiedValues(el, styles, 'color'), parent.color);
  const stroke = specifiedPaint(specifiedValues(el, styles, 'stroke'), parent.stroke);
  const fill = specifiedPaint(specifiedValues(el, styles, 'fill'), parent.fill);
  const opacity = parent.opacity * parseOpacity(presentationValue(el, styles, 'opacity'));
  const strokeOpacity =
    parent.strokeOpacity * parseOpacity(presentationValue(el, styles, 'stroke-opacity'));
  const fillOpacity =
    parent.fillOpacity * parseOpacity(presentationValue(el, styles, 'fill-opacity'));
  const transform = multiplySvgMatrix(
    parent.transform,
    parseSvgTransform(presentationValue(el, styles, 'transform')),
  );
  const property = (name: string) => presentationValue(el, styles, name);

  return {
    stroke,
    fill,
    color,
    fillRule: inheritedSvgFillRule(presentationValue(el, styles, 'fill-rule'), parent.fillRule),
    transform,
    unsupportedEffects: [
      ...parent.unsupportedEffects,
      ...['filter', 'mask'].filter((name) => {
        const value = presentationValue(el, styles, name);
        return value !== null && value !== 'none';
      }),
    ],
    clips: clipReferences(el, presentationValue(el, styles, 'clip-path'), parent.clips, transform),
    ...visibilityState(property, parent, opacity),
    opacity,
    strokeOpacity,
    fillOpacity,
    strokeWidthZero: strokeWidthZero(property('stroke-width'), parent.strokeWidthZero),
    markers: svgMarkerReferences(property, parent.markers),
    viewport: parent.viewport,
  };
}

const VISIBILITY = new Set(['visible', 'hidden', 'collapse']);

// display:none and zero opacity hide the whole subtree. Visibility is only
// inherited, so a descendant that sets it back to visible still renders
// (SVG 2 render.html#VisibilityControl).
function visibilityState(
  property: (name: string) => string | null,
  parent: PresentationState,
  opacity: number,
): Pick<PresentationState, 'hiddenSubtree' | 'hidden' | 'visibility'> {
  const specified = keyword(property('visibility'));
  const visibility =
    specified !== null && VISIBILITY.has(specified) ? specified : parent.visibility;
  const hiddenSubtree =
    parent.hiddenSubtree || keyword(property('display')) === 'none' || opacity <= 0;
  return {
    hiddenSubtree,
    hidden: hiddenSubtree || visibility === 'hidden' || visibility === 'collapse',
    visibility,
  };
}

// A negative or unreadable stroke-width is invalid, so the inherited one applies.
function strokeWidthZero(value: string | null, inherited: boolean): boolean {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?:[a-z]+|%)?$/i.exec(
    keyword(value) ?? '',
  );
  if (match === null) return inherited;
  const width = Number(match[1]);
  return width < 0 ? inherited : width === 0;
}

function keyword(value: string | null): string | null {
  return (
    value
      ?.trim()
      .replace(/\s*!important$/i, '')
      .trim()
      .toLowerCase() ?? null
  );
}

export function numAttr(el: Element, name: string, fallback = 0): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function svgPresentationStyles(
  el: Element,
  cascadeStyles: SvgStyleCascade,
): ReadonlyMap<string, string> {
  return cascadeStyles(el, styleMap(el.getAttribute('style')));
}

// The style declaration outranks the presentation attribute. Each is tried in
// turn because CSS ignores an invalid declaration rather than applying it.
function specifiedValues(
  el: Element,
  styles: ReadonlyMap<string, string>,
  name: string,
): readonly (string | null)[] {
  return [styles.get(name) ?? null, el.getAttribute(name)];
}

// fill and stroke inherit: an unset, `inherit` or invalid value keeps the
// parent's paint.
function specifiedPaint(
  values: readonly (string | null)[],
  inherited: SvgPaint | null,
): SvgPaint | null {
  for (const value of values) {
    if (value === null) continue;
    const paint = parseSvgPaint(value);
    if (paint === 'inherit') return inherited;
    if (paint !== null) return paint;
  }
  return inherited;
}

function presentationValue(
  el: Element,
  styles: ReadonlyMap<string, string>,
  name: string,
): string | null {
  const styleValue = styles.get(name);
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
  const normalized = input
    .trim()
    .replace(/\s*!important$/i, '')
    .trim();
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return 1;
  const fraction = normalized.endsWith('%') ? value / 100 : value;
  return Math.min(1, Math.max(0, fraction));
}

function clipReferences(
  element: Element,
  value: string | null,
  inherited: readonly SvgClipReference[],
  transform: SvgMatrix,
): readonly SvgClipReference[] {
  const id = svgClipPathId(value);
  return id === null ? inherited : [...inherited, { id, transform, element }];
}

/** The local <clipPath> id a clip-path value names, or null for none. */
export function svgClipPathId(value: string | null): string | null {
  const trimmed = value
    ?.trim()
    .replace(/\s*!important$/i, '')
    .trim();
  if (trimmed === undefined || trimmed === 'none') return null;
  const match = /^url\(\s*['"]?#([^\s'")]+)['"]?\s*\)$/.exec(trimmed);
  if (match?.[1] === undefined)
    throw new Error('Only local SVG clip-path references are supported.');
  return match[1];
}
