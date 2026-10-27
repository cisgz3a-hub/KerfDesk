import type { Vec2 } from '../../core/scene';
import { svgNumber } from './export-svg-paths';

/** Explicit artwork-only scene translation in mm; native SVG renderers ignore it. */
export const SVG_ARTWORK_ORIGIN_ATTRIBUTE = 'data-kerfdesk-artwork-origin';
// Each numeral matches one way only, so the match runs in linear time. The
// value KerfDesk writes is far shorter than the cap.
const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const VALUE = new RegExp(String.raw`^v1\s+(${NUMBER})\s+(${NUMBER})$`);
const VALUE_MAX_LENGTH = 256;

export function svgArtworkOriginValue(origin: Vec2): string {
  return `v1 ${svgNumber(origin.x)} ${svgNumber(origin.y)}`;
}

/** Unknown versions and unreadable metadata leave the standard SVG mapping intact. */
export function readSvgArtworkOrigin(svg: Element): Vec2 | null {
  const value = svg.getAttribute(SVG_ARTWORK_ORIGIN_ATTRIBUTE)?.trim() ?? '';
  const match = value.length > VALUE_MAX_LENGTH ? null : VALUE.exec(value);
  if (match === null) return null;
  const origin = { x: Number(match[1]), y: Number(match[2]) };
  return Number.isFinite(origin.x) && Number.isFinite(origin.y) ? origin : null;
}
