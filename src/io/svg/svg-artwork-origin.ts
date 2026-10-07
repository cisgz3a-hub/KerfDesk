import type { Vec2 } from '../../core/scene';
import { svgNumber } from './export-svg-paths';

/** Explicit artwork-only scene translation in mm; native SVG renderers ignore it. */
export const SVG_ARTWORK_ORIGIN_ATTRIBUTE = 'data-kerfdesk-artwork-origin';
const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
const VALUE = new RegExp(String.raw`^v1\s+(${NUMBER})\s+(${NUMBER})$`);

export function svgArtworkOriginValue(origin: Vec2): string {
  return `v1 ${svgNumber(origin.x)} ${svgNumber(origin.y)}`;
}

/** Unknown versions and unreadable metadata leave the standard SVG mapping intact. */
export function readSvgArtworkOrigin(svg: Element): Vec2 | null {
  const value = svg.getAttribute(SVG_ARTWORK_ORIGIN_ATTRIBUTE)?.trim() ?? '';
  const match = VALUE.exec(value);
  if (match === null) return null;
  const origin = { x: Number(match[1]), y: Number(match[2]) };
  return Number.isFinite(origin.x) && Number.isFinite(origin.y) ? origin : null;
}
