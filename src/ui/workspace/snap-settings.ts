// snap-settings — the workspace snapping preference (LightBurn gap LBG-F06).
//
// An app preference, never project data: it lives in the UI store and is kept
// in browser storage, so opening someone else's project never changes how your
// pointer behaves, and no G-code or project schema depends on it.
//
// Reach is in SCREEN PIXELS, converted through the live zoom at every use. A
// millimetre reach feels enormous when zoomed out and useless when zoomed in;
// a pixel reach is a property of the hand and the screen, which is why the
// Design Studio (SNAP_RADIUS_PX) and LightBurn's object-snap distance use it.

export type SnapSettings = {
  // Master switch, toggled by the # button on the canvas.
  readonly enabled: boolean;
  // Magnetic grid: a coordinate within reach of a grid line lands on it.
  readonly snapToGrid: boolean;
  // Box alignment while moving: the moving selection's box edges and centre
  // line up with other artwork's box edges and centres (dashed guides).
  readonly snapToObjects: boolean;
  // Point snapping targets.
  readonly snapToNodes: boolean;
  readonly snapToMidpoints: boolean;
  readonly snapToCenters: boolean;
  readonly snapToIntersections: boolean;
  readonly distancePx: number;
  readonly gridMm: number;
};

export const DEFAULT_SNAP_DISTANCE_PX = 8;
export const MIN_SNAP_DISTANCE_PX = 1;
export const MAX_SNAP_DISTANCE_PX = 50;
export const DEFAULT_SNAP_GRID_MM = 10;
export const MIN_SNAP_GRID_MM = 0.1;
export const MAX_SNAP_GRID_MM = 1000;

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  enabled: true,
  snapToGrid: true,
  snapToObjects: true,
  snapToNodes: true,
  snapToMidpoints: true,
  snapToCenters: true,
  // On by default: with the near-pointer spatial index the crossing search only
  // ever sees the handful of segments under the cursor, so it stays cheap even
  // on 200k-point traces (see scene-snap-query.test.ts).
  snapToIntersections: true,
  distancePx: DEFAULT_SNAP_DISTANCE_PX,
  gridMm: DEFAULT_SNAP_GRID_MM,
};

const BOOLEAN_KEYS = [
  'enabled',
  'snapToGrid',
  'snapToObjects',
  'snapToNodes',
  'snapToMidpoints',
  'snapToCenters',
  'snapToIntersections',
] as const;

// Read any stored or partial value back into a complete, in-range preference.
// Unknown or damaged fields fall back one by one, so a single bad value never
// resets the operator's other choices; numbers out of range are clamped.
export function normalizeSnapSettings(
  value: unknown,
  fallback: SnapSettings = DEFAULT_SNAP_SETTINGS,
): SnapSettings {
  const record = isRecord(value) ? value : {};
  const booleans = Object.fromEntries(
    BOOLEAN_KEYS.map((key) => {
      const raw = record[key];
      return [key, typeof raw === 'boolean' ? raw : fallback[key]];
    }),
  ) as Pick<SnapSettings, (typeof BOOLEAN_KEYS)[number]>;
  return {
    ...booleans,
    distancePx: clampNumber(
      record.distancePx,
      fallback.distancePx,
      MIN_SNAP_DISTANCE_PX,
      MAX_SNAP_DISTANCE_PX,
    ),
    gridMm: clampNumber(record.gridMm, fallback.gridMm, MIN_SNAP_GRID_MM, MAX_SNAP_GRID_MM),
  };
}

export function sameSnapSettings(a: SnapSettings, b: SnapSettings): boolean {
  return (
    BOOLEAN_KEYS.every((key) => a[key] === b[key]) &&
    a.distancePx === b.distancePx &&
    a.gridMm === b.gridMm
  );
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
