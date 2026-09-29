// SVG viewports: preserveAspectRatio, viewBox and the transform an element
// that establishes a new viewport applies to its content
// (SVG 2 coords.html#ViewBoxAttribute, #PreserveAspectRatioAttribute and
// #ComputingAViewportsTransform). Clipping to the viewport is not applied;
// content overflowing a nested viewport imports whole.

import type { SvgMatrix } from './svg-curve-transform';
import { parseSvgLengthUserUnitsOrNull } from './svg-units';

type Alignment = 0 | 0.5 | 1;
export type SvgAspectRatio = {
  /** 'none' stretches; otherwise the fraction of the spare room placed before the content. */
  readonly align: 'none' | { readonly x: Alignment; readonly y: Alignment };
  readonly slice: boolean;
};

export type SvgRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** The width and height that percentages inside a viewport resolve against. */
export type SvgViewportSize = { readonly width: number; readonly height: number };

/** The initial value, xMidYMid meet. */
export const DEFAULT_ASPECT_RATIO: SvgAspectRatio = { align: { x: 0.5, y: 0.5 }, slice: false };

const ALIGNMENTS: ReadonlyMap<string, { readonly x: Alignment; readonly y: Alignment }> = new Map(
  (['Min', 'Mid', 'Max'] as const).flatMap((yName, yIndex) =>
    (['Min', 'Mid', 'Max'] as const).map(
      (xName, xIndex) =>
        [
          `x${xName}Y${yName}`,
          { x: (xIndex / 2) as Alignment, y: (yIndex / 2) as Alignment },
        ] as const,
    ),
  ),
);

/** preserveAspectRatio: "[defer] <align> [meet | slice]"; anything else is the initial value. */
export function parsePreserveAspectRatio(value: string | null): SvgAspectRatio {
  const words = value?.trim().split(/\s+/) ?? [];
  // SVG 1.1's defer applies only to referenced SVG images, which are not imported.
  if (words[0] === 'defer') words.shift();
  const [alignWord, fitWord, extra] = words;
  const align = alignWord === 'none' ? 'none' : ALIGNMENTS.get(alignWord ?? '');
  const fitValid = fitWord === undefined || fitWord === 'meet' || fitWord === 'slice';
  if (align === undefined || !fitValid || extra !== undefined) return DEFAULT_ASPECT_RATIO;
  return { align, slice: fitWord === 'slice' };
}

/**
 * A viewBox attribute's rectangle; null when it is absent or invalid (a
 * negative size is an error), 'empty' when a zero size disables rendering.
 */
export function parseViewBox(value: string | null): SvgRect | 'empty' | null {
  if (value === null) return null;
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [x = 0, y = 0, width = 0, height = 0] = parts;
  if (width < 0 || height < 0) return null;
  return width === 0 || height === 0 ? 'empty' : { x, y, width, height };
}

/** The matrix that maps `viewBox` onto `viewport` (SVG 2 coords.html, steps 1-14). */
export function viewBoxMatrix(
  viewBox: SvgRect,
  viewport: SvgRect,
  aspect: SvgAspectRatio,
): SvgMatrix {
  let scaleX = viewport.width / viewBox.width;
  let scaleY = viewport.height / viewBox.height;
  if (aspect.align !== 'none') {
    const uniform = aspect.slice ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    scaleX = uniform;
    scaleY = uniform;
  }
  let translateX = viewport.x - viewBox.x * scaleX;
  let translateY = viewport.y - viewBox.y * scaleY;
  if (aspect.align !== 'none') {
    translateX += (viewport.width - viewBox.width * scaleX) * aspect.align.x;
    translateY += (viewport.height - viewBox.height * scaleY) * aspect.align.y;
  }
  return { a: scaleX, b: 0, c: 0, d: scaleY, e: translateX, f: translateY };
}

/** Percentages resolve against the root's viewBox, or its absolute size in user units. */
export function rootViewportSize(svg: Element): SvgViewportSize {
  const viewBox = parseViewBox(svg.getAttribute('viewBox'));
  if (viewBox !== null && viewBox !== 'empty')
    return { width: viewBox.width, height: viewBox.height };
  return {
    width: parseSvgLengthUserUnitsOrNull(svg.getAttribute('width')) ?? 100,
    height: parseSvgLengthUserUnitsOrNull(svg.getAttribute('height')) ?? 100,
  };
}

/**
 * The viewport that percentages resolve against at `element`: the root's,
 * narrowed by each nested <svg> the element is inside.
 */
export function svgViewportAt(element: Element): SvgViewportSize {
  const outer: Element[] = [];
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    if (at.tagName.toLowerCase() === 'svg') outer.unshift(at);
  }
  const [root, ...nested] = outer;
  let size = root === undefined ? { width: 100, height: 100 } : rootViewportSize(root);
  for (const svg of nested) size = svgViewportTransform(svg, size)?.viewport ?? size;
  return size;
}

/**
 * The transform a nested <svg>, or the <svg> a <use> makes of a <symbol>,
 * applies to its content, and the viewport its content resolves percentages
 * against; null when a zero size disables rendering. `size` carries the
 * <use> element's width and height, which override the element's own.
 */
export function svgViewportTransform(
  element: Element,
  parent: SvgViewportSize,
  size: { readonly width: number | null; readonly height: number | null } = {
    width: null,
    height: null,
  },
): { readonly matrix: SvgMatrix; readonly viewport: SvgViewportSize } | null {
  const width = size.width ?? viewportLength(element, 'width', parent.width) ?? parent.width;
  const height = size.height ?? viewportLength(element, 'height', parent.height) ?? parent.height;
  const viewBox = parseViewBox(element.getAttribute('viewBox'));
  if (width === 0 || height === 0 || viewBox === 'empty') return null;
  const box = {
    x: viewportLength(element, 'x', parent.width) ?? 0,
    y: viewportLength(element, 'y', parent.height) ?? 0,
    width,
    height,
  };
  if (viewBox === null) {
    return { matrix: { a: 1, b: 0, c: 0, d: 1, e: box.x, f: box.y }, viewport: { width, height } };
  }
  const aspect = parsePreserveAspectRatio(element.getAttribute('preserveAspectRatio'));
  return {
    matrix: viewBoxMatrix(viewBox, box, aspect),
    viewport: { width: viewBox.width, height: viewBox.height },
  };
}

/**
 * An x, y, width or height attribute in user units, a percentage of
 * `reference`; null when absent or unreadable, and for a negative size, which
 * SVG treats as an error rather than a size.
 */
export function viewportLength(element: Element, name: string, reference: number): number | null {
  const raw = element.getAttribute(name)?.trim();
  if (raw === undefined || raw === '') return null;
  const value = raw.endsWith('%')
    ? percentageOf(raw.slice(0, -1), reference)
    : parseSvgLengthUserUnitsOrNull(raw);
  if (value === null || !Number.isFinite(value)) return null;
  return (name === 'width' || name === 'height') && value < 0 ? null : value;
}

function percentageOf(number: string, reference: number): number | null {
  if (!/^[+-]?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(number.trim())) return null;
  return (Number(number) * reference) / 100;
}
