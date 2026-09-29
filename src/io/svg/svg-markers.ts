// Markers (arrowheads and the like, SVG 2 painting.html#Markers) are not
// imported. They are drawn only on path, line, polyline and polygon, from the
// inherited marker-start, marker-mid and marker-end properties (or the
// `marker` shorthand), and only when the reference names a <marker>. Elements
// imported without them are counted so the import can say so.

import type { SvgIdResolver } from './svg-id-resolver';

/** The marker-start, marker-mid and marker-end ids; null is none. */
export type SvgMarkerReferences = readonly (string | null)[];

export const NO_MARKERS: SvgMarkerReferences = [null, null, null];

const MARKABLE = new Set(['path', 'line', 'polyline', 'polygon']);
const PROPERTIES = ['marker-start', 'marker-mid', 'marker-end'] as const;
const LOCAL_URL = /^url\(\s*['"]?#([^\s'")]+)['"]?\s*\)$/;

/** Each marker property as `value` specifies it, or else as inherited. */
export function svgMarkerReferences(
  value: (name: string) => string | null,
  inherited: SvgMarkerReferences,
): SvgMarkerReferences {
  const shorthand = markerReference(value('marker'));
  return PROPERTIES.map((name, index) => {
    const specified = markerReference(value(name));
    if (specified !== undefined) return specified;
    if (shorthand !== undefined) return shorthand;
    return inherited[index] ?? null;
  });
}

/** Whether `el` would draw a marker that the import leaves out. */
export function hasSvgMarkers(
  el: Element,
  markers: SvgMarkerReferences,
  resolveId: SvgIdResolver,
): boolean {
  if (!MARKABLE.has(el.tagName.toLowerCase())) return false;
  return markers.some((id) => id !== null && resolveId(id)?.tagName.toLowerCase() === 'marker');
}

// undefined when unspecified here, `inherit` or unreadable (CSS ignores an
// invalid value), so the inherited value applies; null for none.
function markerReference(value: string | null): string | null | undefined {
  const trimmed = value
    ?.trim()
    .replace(/\s*!important$/i, '')
    .trim();
  if (trimmed === undefined || trimmed === '' || trimmed === 'inherit') return undefined;
  if (trimmed === 'none') return null;
  return LOCAL_URL.exec(trimmed)?.[1] ?? undefined;
}
