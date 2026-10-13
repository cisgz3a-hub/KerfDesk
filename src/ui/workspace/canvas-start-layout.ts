import type { Vec2 } from '../../core/scene';
import type { StartKind } from './canvas-start-editing';

export type StartLayoutRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};
type Size = { readonly width: number; readonly height: number };
const GAP = 4;
export const START_HANDLE_SIZE = 24;

function overlaps(a: StartLayoutRect, b: StartLayoutRect): boolean {
  return (
    a.x < b.x + b.width + GAP &&
    a.x + a.width + GAP > b.x &&
    a.y < b.y + b.height + GAP &&
    a.y + a.height + GAP > b.y
  );
}

/** The closest available box, using actual chrome edges rather than a fixed exclusion strip. */
function placeBox(
  preferred: Vec2,
  size: Size,
  viewport: Size,
  obstacles: ReadonlyArray<StartLayoutRect>,
  artwork: ReadonlyArray<StartLayoutRect> = [],
): StartLayoutRect {
  const clampX = (x: number) => Math.max(GAP, Math.min(viewport.width - size.width - GAP, x));
  const clampY = (y: number) => Math.max(GAP, Math.min(viewport.height - size.height - GAP, y));
  const initial = { x: clampX(preferred.x), y: clampY(preferred.y), ...size };
  const xs = [
    initial.x,
    ...obstacles.flatMap((rect) => [
      clampX(rect.x - size.width - GAP),
      clampX(rect.x + rect.width + GAP),
    ]),
  ];
  const ys = [
    initial.y,
    ...obstacles.flatMap((rect) => [
      clampY(rect.y - size.height - GAP),
      clampY(rect.y + rect.height + GAP),
    ]),
  ];
  const candidates = xs.flatMap((x) => ys.map((y) => ({ x, y, ...size })));
  // Add a linear number of text-edge candidates, not a Cartesian product of
  // every text object's edges. Large text scenes must remain cheap to drag.
  for (const rect of artwork) {
    const left = clampX(rect.x - size.width - GAP);
    const right = clampX(rect.x + rect.width + GAP);
    const top = clampY(rect.y - size.height - GAP);
    const bottom = clampY(rect.y + rect.height + GAP);
    for (const x of [left, right])
      for (const y of [initial.y, top, bottom]) candidates.push({ x, y, ...size });
    for (const y of [top, bottom]) candidates.push({ x: initial.x, y, ...size });
  }
  const distance = (point: Vec2) => (point.x - preferred.x) ** 2 + (point.y - preferred.y) ** 2;
  candidates.sort((a, b) => distance(a) - distance(b));
  let fallback: StartLayoutRect | undefined;
  for (const candidate of candidates) {
    if (obstacles.some((rect) => overlaps(candidate, rect))) continue;
    fallback ??= candidate;
    if (!artwork.some((rect) => overlaps(candidate, rect))) return candidate;
  }
  // At extreme zoom text can cover the viewport; keep the control accessible
  // without moving it over toolbar chrome or another start handle.
  return fallback ?? initial;
}

export function layoutStartHandles(
  points: Partial<Record<StartKind, Vec2>>,
  viewport: Size,
  chrome: ReadonlyArray<StartLayoutRect>,
  artwork: ReadonlyArray<StartLayoutRect> = [],
): Partial<Record<StartKind, StartLayoutRect>> {
  const near =
    points.frame !== undefined &&
    points.job !== undefined &&
    Math.hypot(points.frame.x - points.job.x, points.frame.y - points.job.y) < 25;
  const occupied = [...chrome];
  const result: Partial<Record<StartKind, StartLayoutRect>> = {};
  for (const kind of ['frame', 'job'] as const) {
    const point = points[kind];
    if (point === undefined) continue;
    // Panning artwork away must not leave edge handles and long connectors.
    if (point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height)
      continue;
    const offset = near ? (kind === 'frame' ? -14 : 14) : 0;
    const box = placeBox(
      { x: point.x + offset - 12, y: point.y - 12 },
      { width: START_HANDLE_SIZE, height: START_HANDLE_SIZE },
      viewport,
      occupied,
      artwork,
    );
    result[kind] = box;
    occupied.push(box);
  }
  return result;
}

export function layoutStartLabel(
  kind: StartKind,
  handle: StartLayoutRect,
  size: Size,
  viewport: Size,
  obstacles: ReadonlyArray<StartLayoutRect>,
): StartLayoutRect {
  const preferred =
    kind === 'frame'
      ? { x: handle.x - size.width, y: handle.y - size.height - GAP }
      : { x: handle.x + handle.width, y: handle.y + handle.height + GAP };
  return placeBox(preferred, size, viewport, [...obstacles, handle]);
}
