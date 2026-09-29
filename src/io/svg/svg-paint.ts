// SVG <paint> values for fill and stroke, and the `color` property that
// currentColor reads (SVG 2 painting.html#SpecifyingPaint, CSS Color 4).
//
// A value that is not a valid paint is ignored, as CSS ignores an invalid
// declaration, so the property keeps its inherited value. currentColor is kept
// as a keyword and inherited as one, as CSS Color 4 computes it; it takes the
// `color` of the element that finally paints. Paint servers stay references
// here; svg-paint-server.ts reads them with the document's id table.

import { parseCssColor } from './svg-css-color';

export type SvgNoPaint = { readonly kind: 'none' };
export type SvgColorPaint = { readonly kind: 'color'; readonly color: string };
export type SvgCurrentColorPaint = { readonly kind: 'currentcolor' };
export type SvgSimplePaint = SvgNoPaint | SvgColorPaint | SvgCurrentColorPaint;
/** url(#id) [fallback]. `id` is null for a reference outside the document. */
export type SvgServerPaint = {
  readonly kind: 'server';
  readonly id: string | null;
  readonly fallback: SvgSimplePaint | null;
};
export type SvgPaint = SvgSimplePaint | SvgServerPaint;
/** A computed `color` property: a colour, or nothing when it is transparent. */
export type SvgColorValue = SvgNoPaint | SvgColorPaint;

export const NO_PAINT: SvgNoPaint = { kind: 'none' };
export const BLACK_PAINT: SvgColorPaint = { kind: 'color', color: '#000000' };

const URL_PAINT = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"')]*))\s*\)\s*(.*)$/is;

/**
 * The paint `value` specifies; 'inherit' for the parent's paint; null when the
 * value is not a valid paint and so is ignored. A colour with zero alpha, such
 * as `transparent`, paints nothing.
 */
export function parseSvgPaint(value: string): SvgPaint | 'inherit' | null {
  const text = withoutImportance(value);
  if (text.toLowerCase() === 'inherit') return 'inherit';
  const url = URL_PAINT.exec(text);
  if (url === null) return simplePaint(text);
  const fallbackText = (url[4] ?? '').trim();
  const fallback = fallbackText === '' ? null : simplePaint(fallbackText);
  if (fallbackText !== '' && fallback === null) return null;
  const reference = url[1] ?? url[2] ?? url[3] ?? '';
  const id = reference.startsWith('#') && reference.length > 1 ? reference.slice(1) : null;
  return { kind: 'server', id, fallback };
}

/**
 * The computed `color` property from its specified values, most important
 * first. currentColor and `inherit` in `color` itself take the parent's value;
 * an invalid value is ignored. With nothing valid, the parent's value inherits.
 */
export function resolveSvgColorProperty(
  values: readonly (string | null)[],
  parent: SvgColorValue,
): SvgColorValue {
  for (const value of values) {
    if (value === null) continue;
    const paint = simplePaint(withoutImportance(value));
    if (paint?.kind === 'currentcolor' || withoutImportance(value).toLowerCase() === 'inherit')
      return parent;
    if (paint !== null) return paint;
  }
  return parent;
}

/** The #rrggbb a simple paint paints with, or '' for none. */
export function simplePaintColor(paint: SvgSimplePaint, color: SvgColorValue): string {
  const resolved = paint.kind === 'currentcolor' ? color : paint;
  return resolved.kind === 'color' ? resolved.color : '';
}

function simplePaint(text: string): SvgSimplePaint | null {
  const keyword = text.toLowerCase();
  if (keyword === 'none') return NO_PAINT;
  if (keyword === 'currentcolor') return { kind: 'currentcolor' };
  const color = parseCssColor(keyword);
  if (color === null) return null;
  return color.alpha > 0 ? { kind: 'color', color: color.hex } : NO_PAINT;
}

// An !important on an inline style value decides the cascade, not the paint.
function withoutImportance(value: string): string {
  return value
    .trim()
    .replace(/\s*!\s*important$/i, '')
    .trim();
}
