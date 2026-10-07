import { parseCanonicalStatusNumber } from './status-parser';
import {
  parseActiveWcsFromModalResponses,
  type ActiveWorkCoordinateSystem,
} from './work-offset-readback';

export type SurfaceGridRequest = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly columns: number;
  readonly rows: number;
  readonly seekFeed: number;
  readonly probeFeed: number;
  readonly travelFeed: number;
  readonly maxTravelMm: number;
  /** Operator has raised the current Z above the whole requested region. */
  readonly clearancePrepared: true;
};
export type SurfacePoint = {
  readonly row: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly machineZ: number;
};
export type SurfaceGridMeasurement = {
  readonly request: SurfaceGridRequest;
  readonly points: ReadonlyArray<SurfacePoint>;
  readonly activeWcs: ActiveWorkCoordinateSystem;
  readonly offsetMm: { readonly x: number; readonly y: number; readonly z: number };
  readonly clearanceZMm: number;
  readonly reportInches: boolean;
  readonly sessionEpoch: number;
  readonly measuredAt: number;
  readonly complete: boolean;
};
export type SurfaceGridResult =
  | { readonly kind: 'ok'; readonly measurement: SurfaceGridMeasurement }
  | {
      readonly kind: 'failed';
      readonly reason: string;
      readonly measurement?: SurfaceGridMeasurement;
    };

export function validateSurfaceGrid(request: SurfaceGridRequest): void {
  if (request.clearancePrepared !== true)
    throw new Error(
      'Raise Z above the whole region and confirm the clearance plane before measuring.',
    );
  const coords = [request.minX, request.minY, request.maxX, request.maxY];
  if (
    !coords.every(
      (n) =>
        Number.isFinite(n) &&
        Math.abs(n) <= 100_000 &&
        Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-7,
    )
  )
    throw new Error('Grid coordinates must be finite millimetres with at most 0.001 mm precision.');
  if (request.maxX <= request.minX || request.maxY <= request.minY)
    throw new Error('Grid width and height must be positive.');
  if (
    ![request.columns, request.rows].every((n) => Number.isInteger(n) && n >= 2 && n <= 20) ||
    request.columns * request.rows > 400
  )
    throw new Error('Use 2–20 rows and columns, with at most 400 contacts.');
  if (
    ![request.seekFeed, request.probeFeed, request.travelFeed].every(
      (n) => Number.isFinite(n) && n >= 1 && n <= 10_000 && Number.isInteger(n),
    )
  )
    throw new Error('Feeds must be whole numbers from 1 to 10000 mm/min.');
  if (request.probeFeed >= request.seekFeed)
    throw new Error('Slow contact feed must be below seek feed.');
  if (!validTravel(request.maxTravelMm))
    throw new Error('Maximum downward travel must be 1–100 mm with at most 0.001 mm precision.');
}

function validTravel(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 100 &&
    Math.abs(value * 1000 - Math.round(value * 1000)) <= 1e-7
  );
}

export function surfaceGridPositions(
  request: SurfaceGridRequest,
): ReadonlyArray<Omit<SurfacePoint, 'z' | 'machineZ'>> {
  validateSurfaceGrid(request);
  const points: Array<Omit<SurfacePoint, 'z' | 'machineZ'>> = [];
  for (let row = 0; row < request.rows; row += 1) {
    for (let step = 0; step < request.columns; step += 1) {
      const column = row % 2 === 0 ? step : request.columns - 1 - step;
      points.push({
        row,
        column,
        x: round(request.minX + ((request.maxX - request.minX) * column) / (request.columns - 1)),
        y: round(request.minY + ((request.maxY - request.minY) * row) / (request.rows - 1)),
      });
    }
  }
  return points;
}

export function surfaceGridModalContext(
  modal: ReadonlyArray<string>,
  offsets: ReadonlyArray<string>,
): ActiveWorkCoordinateSystem {
  const active = parseActiveWcsFromModalResponses(modal);
  const body = modal.filter((line) => /^\[GC:/.test(line.trim()))[0]?.trim();
  if (active === null || body === undefined)
    throw new Error('Surface measurement needs one owned active G54–G59 report.');
  const words = body.slice(4, -1).split(/\s+/);
  if (!words.includes('G94') || words.some((word) => /^(G7|G51|G68|G93|G95)$/.test(word)))
    throw new Error(
      'Surface measurement requires ordinary Cartesian coordinates and feed per minute.',
    );
  const report = offsets.filter((line) => line.startsWith(`[${active}:`));
  if (report.length !== 1)
    throw new Error('Surface measurement needs one owned active work-offset report.');
  validateSurfaceOffset((report[0] ?? '').slice(active.length + 2, -1));
  return active;
}

function validateSurfaceOffset(body: string): void {
  const parts = body.split(':');
  if (parts.length > 2 || (parts[1] !== undefined && Number(parts[1]) !== 0))
    throw new Error('Rotated work coordinates are not supported by this grid measurement.');
  const axes = (parts[0] ?? '').split(',').map(parseCanonicalStatusNumber);
  if (axes.length < 3 || axes.some((n) => n === null))
    throw new Error('Active work-offset coordinates are invalid.');
}

/** PRB is machine position, in the firmware's $13 report units, not parser G20/G21. */
export function parseSurfaceContact(
  responses: ReadonlyArray<string>,
  reportInches: boolean,
): { readonly x: number; readonly y: number; readonly z: number } {
  const reports = responses.filter((line) => line.trim().startsWith('[PRB:'));
  if (reports.length !== 1)
    throw new Error('Expected exactly one contact report from the owned probe line.');
  const match = /^\[PRB:([^\]]+):1\]$/.exec(reports[0]?.trim() ?? '');
  if (match === null) throw new Error('Probe contact was not confirmed successful.');
  const coords = surfaceAxes(match[1] ?? '');
  const scale = reportInches ? 25.4 : 1;
  return { x: coords.x * scale, y: coords.y * scale, z: coords.z * scale };
}

function surfaceAxes(body: string): { readonly x: number; readonly y: number; readonly z: number } {
  const coords = body.split(',').map(parseCanonicalStatusNumber);
  const [x, y, z] = coords;
  if (coords.length > 9 || coords.some((n) => n === null) || x == null || y == null || z == null)
    throw new Error('Probe contact coordinates are invalid.');
  return { x, y, z };
}

export function validateSurfaceContact(
  contact: { readonly x: number; readonly y: number; readonly z: number },
  point: { readonly x: number; readonly y: number },
  offset: { readonly x: number; readonly y: number; readonly z: number },
  clearanceZ: number,
  maxTravel: number,
): number {
  if (
    Math.abs(contact.x - offset.x - point.x) > 0.02 ||
    Math.abs(contact.y - offset.y - point.y) > 0.02
  )
    throw new Error('Probe XY did not match the requested grid point.');
  const z = contact.z - offset.z;
  if (z > clearanceZ + 0.02 || z < clearanceZ - maxTravel - 0.02)
    throw new Error('Probe Z fell outside the requested downward travel.');
  return z;
}

/** Absolute endpoints: release above the contact without leaving the prepared Z envelope. */
export function surfaceGridRetouchPlan(
  fastWorkZ: number,
  clearanceZ: number,
  maxTravel: number,
): { readonly retractZMm: number; readonly slowTargetZMm: number } {
  if (
    ![fastWorkZ, clearanceZ].every(Number.isFinite) ||
    !validTravel(maxTravel) ||
    Math.abs(clearanceZ * 1000 - Math.round(clearanceZ * 1000)) > 1e-7
  )
    throw new Error('Retouch planning needs finite contact and representable clearance/travel.');
  // Plan in emitted 0.001mm units. Conservative rounding never extends either boundary.
  const clearance = Math.round(clearanceZ * 1000);
  const floor = clearance - Math.round(maxTravel * 1000);
  const fast = fastWorkZ * 1000;
  if (fast < floor - 1e-7 || fast >= clearance)
    throw new Error('Fast contact leaves no valid clearance within the requested probe envelope.');
  const retract = Math.min(clearance, Math.floor(fast + 2000 + 1e-7));
  const slowTarget = Math.max(floor, Math.ceil(fast - 1000 - 1e-7));
  if (retract - fast < 1 - 1e-7 || slowTarget > fast + 1e-7 || slowTarget >= retract)
    throw new Error('Fast contact leaves no positive 0.001mm release for a bounded slow retouch.');
  return { retractZMm: retract / 1000, slowTargetZMm: slowTarget / 1000 };
}

export function surfaceGridCsv(measurement: SurfaceGridMeasurement): string {
  return (
    [
      'row,column,work_x_mm,work_y_mm,work_z_mm,machine_z_mm',
      ...measurement.points.map((p) =>
        [p.row + 1, p.column + 1, p.x, p.y, p.z, p.machineZ].map((n) => n.toFixed(4)).join(','),
      ),
    ].join('\n') + '\n'
  );
}

export function surfaceNumber(n: number): string {
  return round(n).toFixed(3);
}
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
