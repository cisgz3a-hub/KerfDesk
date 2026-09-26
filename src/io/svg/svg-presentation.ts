import type { ColoredPath } from '../../core/scene';
import type { SvgMatrix } from './svg-curve-transform';
import { multiplySvgMatrix, parseSvgTransform } from './svg-transform-attribute';
import { inheritedSvgFillRule } from './svg-fill-rule';
import type { SvgStyleCascade } from './svg-stylesheet';

export type SvgClipReference = { readonly id: string; readonly transform: SvgMatrix };

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
export function normalizeColor(input: string | null): string {
  if (input === null) return '';
  const s = input.trim().toLowerCase();
  if (s === 'none' || s === '') return '';
  if (s in NAMED_COLORS) return NAMED_COLORS[s] ?? COLOR_FALLBACK;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return expandShortHex(s);
  return tryParseRgb(s) ?? COLOR_FALLBACK;
}

export type PresentationState = {
  readonly stroke: string | null;
  readonly fill: string | null;
  readonly fillRule: ColoredPath['fillRule'];
  readonly transform: SvgMatrix;
  readonly unsupportedEffects: readonly string[];
  readonly clips: readonly SvgClipReference[];
  readonly hidden: boolean;
  readonly opacity: number;
  readonly strokeOpacity: number;
  readonly fillOpacity: number;
  readonly visibility: string | null;
};

const IDENTITY_MATRIX: SvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const INITIAL_PRESENTATION_STATE: PresentationState = {
  stroke: null,
  fill: null,
  fillRule: undefined,
  transform: IDENTITY_MATRIX,
  clips: [],
  unsupportedEffects: [],
  hidden: false,
  opacity: 1,
  strokeOpacity: 1,
  fillOpacity: 1,
  visibility: null,
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
  const stroke = presentationValue(el, styles, 'stroke') ?? parent.stroke;
  const fill = presentationValue(el, styles, 'fill') ?? parent.fill;
  const visibility = presentationValue(el, styles, 'visibility') ?? parent.visibility;
  const display = presentationValue(el, styles, 'display');
  const opacity = parent.opacity * parseOpacity(presentationValue(el, styles, 'opacity'));
  const strokeOpacity =
    parent.strokeOpacity * parseOpacity(presentationValue(el, styles, 'stroke-opacity'));
  const fillOpacity =
    parent.fillOpacity * parseOpacity(presentationValue(el, styles, 'fill-opacity'));
  const transform = multiplySvgMatrix(
    parent.transform,
    parseSvgTransform(presentationValue(el, styles, 'transform')),
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
    fillRule: inheritedSvgFillRule(presentationValue(el, styles, 'fill-rule'), parent.fillRule),
    transform,
    unsupportedEffects: [
      ...parent.unsupportedEffects,
      ...['filter', 'mask'].filter((name) => {
        const value = presentationValue(el, styles, name);
        return value !== null && value !== 'none';
      }),
    ],
    clips: clipReferences(presentationValue(el, styles, 'clip-path'), parent.clips, transform),
    hidden,
    opacity,
    strokeOpacity,
    fillOpacity,
    visibility,
  };
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
  value: string | null,
  inherited: readonly SvgClipReference[],
  transform: SvgMatrix,
): readonly SvgClipReference[] {
  if (value === null || value.trim() === 'none') return inherited;
  const match = /^url\(\s*['"]?#([^\s'")]+)['"]?\s*\)$/.exec(value.trim());
  if (match?.[1] === undefined)
    throw new Error('Only local SVG clip-path references are supported.');
  return [...inherited, { id: match[1], transform }];
}
