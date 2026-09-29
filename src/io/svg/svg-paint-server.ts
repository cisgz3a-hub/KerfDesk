// Resolves a paint to the colour an imported element is keyed by, including
// paint-server references (SVG 2 pservers.html, painting.html#SpecifyingPaint).
//
// KerfDesk cuts and engraves solid colours; it cannot reproduce a gradient or a
// pattern. A gradient paints with one deterministic colour, its first stop with
// non-zero opacity, so gradient artwork keeps its own operation instead of
// merging into black; the caller discloses that. A pattern (including the
// pattern-plus-image form design tools write for image fills) paints nothing
// here, and the caller discloses the skipped paint. A reference that names no
// paint server paints the fallback colour when one is given, and otherwise
// nothing, as SVG 2 renders an invalid paint server reference.

import type { SvgIdResolver } from './svg-id-resolver';
import { parseCssColor } from './svg-css-color';
import {
  resolveSvgColorProperty,
  simplePaintColor,
  type SvgColorValue,
  type SvgPaint,
} from './svg-paint';
import { svgPresentationStyles } from './svg-presentation';
import type { SvgStyleCascade } from './svg-stylesheet';

export type ResolvedSvgPaint = {
  /** #rrggbb, or '' when the paint paints nothing. */
  readonly color: string;
  readonly server: 'gradient' | 'pattern' | null;
};

export type SvgPaintResolver = (paint: SvgPaint, color: SvgColorValue) => ResolvedSvgPaint;

// Gradient href chains and property ancestry are read no further than this, so
// a crafted file cannot make one paint walk an unbounded chain.
const MAX_CHAIN = 256;

export function createSvgPaintResolver(
  resolveId: SvgIdResolver,
  cascade: SvgStyleCascade,
): SvgPaintResolver {
  const gradientColors = new Map<Element, string>();
  return (paint, color) => {
    if (paint.kind !== 'server') return { color: simplePaintColor(paint, color), server: null };
    const target = paint.id === null ? null : resolveId(paint.id);
    if (target !== null && isGradient(target)) {
      let gradientColor = gradientColors.get(target);
      if (gradientColor === undefined) {
        gradientColor = firstVisibleStopColor(gradientStops(target, resolveId), cascade);
        gradientColors.set(target, gradientColor);
      }
      return { color: gradientColor, server: 'gradient' };
    }
    if (target?.tagName.toLowerCase() === 'pattern') return { color: '', server: 'pattern' };
    const fallback = paint.fallback === null ? '' : simplePaintColor(paint.fallback, color);
    return { color: fallback, server: null };
  };
}

function isGradient(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === 'lineargradient' || tag === 'radialgradient';
}

// A gradient without stops of its own uses the stops of the gradient its href
// names, following the chain (SVG 2 pservers.html, the href attribute).
function gradientStops(gradient: Element, resolveId: SvgIdResolver): Element[] {
  const seen = new Set<Element>();
  let current: Element | null = gradient;
  while (current !== null && !seen.has(current) && seen.size < MAX_CHAIN) {
    seen.add(current);
    const stops = Array.from(current.children).filter(
      (child) => child.tagName.toLowerCase() === 'stop',
    );
    if (stops.length > 0) return stops;
    const href: string | null = current.getAttribute('href') ?? current.getAttribute('xlink:href');
    const next: Element | null = href?.startsWith('#') === true ? resolveId(href.slice(1)) : null;
    current = next !== null && isGradient(next) ? next : null;
  }
  return [];
}

function firstVisibleStopColor(stops: readonly Element[], cascade: SvgStyleCascade): string {
  for (const stop of stops) {
    const styles = svgPresentationStyles(stop, cascade);
    const color = stopColor(stop, styles, cascade);
    const opacity = stopOpacity(styles.get('stop-opacity') ?? stop.getAttribute('stop-opacity'));
    if (color !== null && color.alpha * opacity > 0) return color.hex;
  }
  return '';
}

// stop-color is not inherited and starts black; currentColor reads the stop's
// own computed `color`.
function stopColor(
  stop: Element,
  styles: ReadonlyMap<string, string>,
  cascade: SvgStyleCascade,
): { readonly hex: string; readonly alpha: number } | null {
  for (const value of [styles.get('stop-color') ?? null, stop.getAttribute('stop-color')]) {
    const keyword = value?.trim().toLowerCase();
    if (keyword === undefined) continue;
    if (keyword === 'currentcolor') {
      const color = computedColor(stop, cascade);
      return color.kind === 'color' ? { hex: color.color, alpha: 1 } : null;
    }
    const color = parseCssColor(keyword);
    if (color !== null) return color;
  }
  return { hex: '#000000', alpha: 1 };
}

function stopOpacity(value: string | null | undefined): number {
  const text = value?.trim() ?? '';
  const number = Number.parseFloat(text);
  if (!Number.isFinite(number)) return 1;
  const fraction = text.endsWith('%') ? number / 100 : number;
  return Math.min(1, Math.max(0, fraction));
}

// The `color` property inherits, so the nearest ancestor that specifies a
// valid colour decides it; SVG content starts black.
function computedColor(element: Element, cascade: SvgStyleCascade): SvgColorValue {
  const chain: Element[] = [];
  for (let at: Element | null = element; at !== null && chain.length < MAX_CHAIN; ) {
    chain.push(at);
    at = at.parentElement;
  }
  let color: SvgColorValue = { kind: 'color', color: '#000000' };
  for (const at of chain.reverse()) {
    const styles = svgPresentationStyles(at, cascade);
    color = resolveSvgColorProperty([styles.get('color') ?? null, at.getAttribute('color')], color);
  }
  return color;
}
