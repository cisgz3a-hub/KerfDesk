// One pool member's contribution to its Fill pool (ADR-683), exactly as
// layer-fill.ts burns one object.

import {
  normalizeClosedPolylinesEvenOddChecked,
  normalizeClosedPolylinesNonZeroChecked,
} from '../../core/geometry/polygon-difference';
import type { Polyline } from '../../core/scene';
import type { DisplayPolylines } from './display-polylines';
import type { PathDisplay } from './object-display';

// Object-space contours whose even-odd parity is this member's own region:
// its single even-odd path as drawn, or else each path resolved by its rule
// and the paths unioned, exactly as layer-fill.ts burns one object.
const closedCache = new WeakMap<DisplayPolylines, ReadonlyArray<Polyline>>();
const resolvedCache = new WeakMap<
  DisplayPolylines,
  {
    readonly displays: ReadonlyArray<DisplayPolylines>;
    readonly rules: string;
    readonly contours: ReadonlyArray<Polyline>;
  }
>();

export function parityContours(paths: ReadonlyArray<PathDisplay>): ReadonlyArray<Polyline> {
  const [only, ...others] = paths;
  if (only === undefined) return [];
  const rules = paths.map(fillRuleOf).join(',');
  if (others.length === 0 && rules === 'evenodd') return closedContours(only.fillDisplay);
  const displays = paths.map((path) => path.fillDisplay);
  const cached = resolvedCache.get(only.fillDisplay);
  if (
    cached !== undefined &&
    cached.rules === rules &&
    cached.displays.length === displays.length &&
    cached.displays.every((display, i) => display === displays[i])
  ) {
    return cached.contours;
  }
  const contours = resolvedRegion(paths);
  resolvedCache.set(only.fillDisplay, { displays, rules, contours });
  return contours;
}

function fillRuleOf(path: PathDisplay): CanvasFillRule {
  return path.fillRule;
}

function resolvedRegion(paths: ReadonlyArray<PathDisplay>): ReadonlyArray<Polyline> {
  const batches: Polyline[] = [];
  for (const path of paths) {
    const closed = closedContours(path.fillDisplay);
    const resolved =
      fillRuleOf(path) === 'nonzero'
        ? normalizeClosedPolylinesNonZeroChecked(closed)
        : normalizeClosedPolylinesEvenOddChecked(closed);
    // The compiler falls back to the raw contours under even-odd as well.
    if (resolved.kind === 'error') {
      return paths.flatMap((each) => closedContours(each.fillDisplay));
    }
    for (const contour of resolved.value) batches.push(contour);
  }
  const union = normalizeClosedPolylinesNonZeroChecked(batches);
  return union.kind === 'ok' ? union.value : batches;
}

function closedContours(display: DisplayPolylines): ReadonlyArray<Polyline> {
  const cached = closedCache.get(display);
  if (cached !== undefined) return cached;
  const closed = display.polylines.filter((polyline) => polyline.closed);
  closedCache.set(display, closed);
  return closed;
}
