// Touch-plate probing sequences (ADR-102 G2, F-CNC20).
//
// Two workflows, both two-stage (fast seek, back off, slow re-touch — the
// gSender/Carbide-Motion convention that removes seek-speed overshoot from
// the recorded position):
//   - Z: probe down onto the plate, set work Z so Z0 = plate underside
//     (= stock top) via `G10 L20 P0 Z<thickness>`.
//   - XYZ corner: Z first, then probe each side face of the plate. At side
//     contact the bit CENTER sits one bit-radius outside the stock face, so
//     the work zero is `G10 L20 P0 <axis><-dir·radius>`.
//
// Geometry model (PROVISIONAL, ADR-102): a rectangular corner plate whose
// outer faces sit flush with the stock faces, wide enough that the plate
// center is ~15 mm inside the probed corner. The operator starts the cycle
// with the bit hovering over the plate center. All distances are editable
// in the panel; these builders just turn them into G-code lines.
//
// Pure module: no IO, no store — returns the line list for the protocol
// runner in ui/state/probe-actions.ts.

export type ProbeCorner = 'front-left' | 'front-right' | 'back-left' | 'back-right';

export type ZProbeParams = {
  readonly plateThicknessMm: number;
  readonly seekFeedMmPerMin: number;
  readonly probeFeedMmPerMin: number;
  readonly maxTravelMm: number;
  readonly retractMm: number;
};

export type CornerProbeParams = ZProbeParams & {
  readonly bitDiameterMm: number;
  readonly corner: ProbeCorner;
  /** How far below the plate TOP the bit flank touches the side faces. */
  readonly sideDropMm: number;
  /** Sideways move past the plate face before descending to probe back. */
  readonly sideClearanceMm: number;
};

export const DEFAULT_Z_PROBE_PARAMS: ZProbeParams = {
  plateThicknessMm: 15,
  seekFeedMmPerMin: 150,
  probeFeedMmPerMin: 25,
  maxTravelMm: 25,
  retractMm: 5,
};
export const DEFAULT_SIDE_DROP_MM = 6;
export const DEFAULT_SIDE_CLEARANCE_MM = 35;

// Back off this far after the fast seek, then re-touch slowly with a small
// extra budget so the slow probe always reaches the surface.
const BACKOFF_MM = 2;
const SLOW_RETOUCH_BUDGET_MM = BACKOFF_MM + 1;
// Clearance above the plate top for lateral repositioning moves.
const PLATE_TOP_CLEAR_MM = 5;
// Relative retreat off a side face after zeroing it.
const SIDE_RETREAT_MM = 4;
// Lateral travel budget past the requested clearance for side probes.
const SIDE_TRAVEL_MARGIN_MM = 5;
// Where the plate center sits, measured from the probed corner.
const PLATE_CENTER_MM = 15;
// Final XY park just outside the zeroed corner.
const FINAL_PARK_MM = 5;
// Keep the flank contact height at least this far above the stock top.
const MIN_FLANK_HEIGHT_MM = 1;

function fmt(value: number): string {
  // -0.000 reads as a distinct coordinate in diffs; normalize it away.
  const text = value.toFixed(3);
  return text === '-0.000' ? '0.000' : text;
}

/** Z-only touch-plate cycle. Ends `retractMm` above the plate top, G90. */
export function buildZProbeLines(params: ZProbeParams): ReadonlyArray<string> {
  return [
    'G21',
    'G91',
    `G38.2 Z${fmt(-params.maxTravelMm)} F${fmt(params.seekFeedMmPerMin)}`,
    `G0 Z${fmt(BACKOFF_MM)}`,
    `G38.2 Z${fmt(-SLOW_RETOUCH_BUDGET_MM)} F${fmt(params.probeFeedMmPerMin)}`,
    `G10 L20 P0 Z${fmt(params.plateThicknessMm)}`,
    `G0 Z${fmt(params.retractMm)}`,
    'G90',
  ];
}

type CornerSigns = { readonly sx: 1 | -1; readonly sy: 1 | -1 };

// Probe DIRECTION per corner: the bit sits outside the plate face and
// probes back toward the stock, so a front-left corner probes +X and +Y.
function cornerSigns(corner: ProbeCorner): CornerSigns {
  switch (corner) {
    case 'front-left':
      return { sx: 1, sy: 1 };
    case 'front-right':
      return { sx: -1, sy: 1 };
    case 'back-left':
      return { sx: 1, sy: -1 };
    case 'back-right':
      return { sx: -1, sy: -1 };
  }
}

// One side face: clear the face laterally, drop to flank height (absolute —
// Z is already zeroed), two-stage probe back into the face, zero the axis,
// retreat, and lift back above the plate.
function sideLegLines(
  axis: 'X' | 'Y',
  dir: 1 | -1,
  params: CornerProbeParams,
  zTopMm: number,
): ReadonlyArray<string> {
  const radius = params.bitDiameterMm / 2;
  const flankZ = Math.max(MIN_FLANK_HEIGHT_MM, params.plateThicknessMm - params.sideDropMm);
  const travel = params.sideClearanceMm + SIDE_TRAVEL_MARGIN_MM;
  return [
    'G91',
    `G0 ${axis}${fmt(-dir * params.sideClearanceMm)}`,
    'G90',
    `G0 Z${fmt(flankZ)}`,
    'G91',
    `G38.2 ${axis}${fmt(dir * travel)} F${fmt(params.seekFeedMmPerMin)}`,
    `G0 ${axis}${fmt(-dir * BACKOFF_MM)}`,
    `G38.2 ${axis}${fmt(dir * SLOW_RETOUCH_BUDGET_MM)} F${fmt(params.probeFeedMmPerMin)}`,
    `G10 L20 P0 ${axis}${fmt(-dir * radius)}`,
    `G0 ${axis}${fmt(-dir * SIDE_RETREAT_MM)}`,
    'G90',
    `G0 Z${fmt(zTopMm)}`,
  ];
}

/**
 * Full XYZ corner cycle: Z onto the plate top, X and Y against the plate's
 * outer faces, ending parked just outside the zeroed corner above the plate.
 */
export function buildCornerProbeLines(params: CornerProbeParams): ReadonlyArray<string> {
  const { sx, sy } = cornerSigns(params.corner);
  const zTop = params.plateThicknessMm + PLATE_TOP_CLEAR_MM;
  return [
    ...buildZProbeLines({ ...params, retractMm: PLATE_TOP_CLEAR_MM }),
    ...sideLegLines('X', sx, params, zTop),
    // Re-center over the plate (X is zeroed now, so absolute is exact)
    // before probing the front/back face.
    `G0 X${fmt(sx * PLATE_CENTER_MM)}`,
    ...sideLegLines('Y', sy, params, zTop),
    `G0 X${fmt(-sx * FINAL_PARK_MM)} Y${fmt(-sy * FINAL_PARK_MM)}`,
  ];
}
