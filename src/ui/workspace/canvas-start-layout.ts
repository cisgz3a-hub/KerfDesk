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
  let best = initial;
  let distance = Number.POSITIVE_INFINITY;
  for (const x of xs)
    for (const y of ys) {
      const candidate = { x, y, ...size };
      if (obstacles.some((rect) => overlaps(candidate, rect))) continue;
      const nextDistance = (x - preferred.x) ** 2 + (y - preferred.y) ** 2;
      if (nextDistance < distance) {
        best = candidate;
        distance = nextDistance;
      }
    }
  return best;
}

export function layoutStartHandles(
  points: Partial<Record<StartKind, Vec2>>,
  viewport: Size,
  chrome: ReadonlyArray<StartLayoutRect>,
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
