// CNC tiling (Phase H.10, F-CNC19): jobs larger than the bed split into an
// indexed row/col tile grid. Each tile's job contains only the motion
// inside its rectangle (polylines clipped at the boundary with entry/exit
// interpolation — Z included for path3d), translated so the tile's min
// corner sits at the program origin: the operator slides the stock between
// tiles and re-zeros XY on the tile frame. Adjacent tiles share
// registration holes drilled in the overlap strip at IDENTICAL stock
// positions, so dowel pins re-index the stock physically. Those holes are
// placed clear of every part and cut and inside the stock
// (tile-registration-placement.ts), and each piece a tile edge starts is
// entered the way its operation asked (tile-clipped-entries.ts).

import { type CncGroup, type Job, cncPassXyPoints } from '../job';
import { placeCncParks } from '../job/job-origin';
import type { CncMachineConfig, CncTiling, Vec2 } from '../scene';
import type { DeviceProfile } from '../devices';
import type { CncTile, TiledJob, TileRegistrationHole } from './cnc-tile';
import type { TiledJobsResult } from './tile-plan-result';
import { planTiles } from './plan-tiles';
import { maximumRegistrationHolesPerTile, registrationGroupForTile } from './tile-registration';
import { resolveTileRegistration, type ResolvedTileRegistration } from './tile-registration-plan';
import {
  placeTileRegistrationHoles,
  registrationHolesForTile,
  type RegistrationPlacement,
} from './tile-registration-placement';
import { orderGroupsIntoToolSections } from './cnc-tool-sections';
import type { EffectiveCncTileGrid } from './effective-cnc-tile-grid';
import type { TileEntryReport } from './tile-clipped-entries';
import { clipGroupToTile, clippedLengthMm, tiledSourceLengthMm } from './tile-clip';
import { countsTowardCutLength, tileSetAdvisories } from './tile-plan-advisories';

export type { CncTile, TiledJob } from './cnc-tile';
export type { TilePlanResult, TiledJobsResult } from './tile-plan-result';
export { planTiles } from './plan-tiles';
export { REGISTRATION_HOLE_DEPTH_MM } from './tile-registration';

type TileContext = {
  readonly machine: CncMachineConfig;
  readonly device: DeviceProfile;
};

/** Split a CNC job across a bounded effective grid, dropping motionless tiles. */
export function tileJobs(job: Job, tiling: CncTiling, context?: TileContext): TiledJobsResult {
  const bounds = cncJobBounds(job);
  if (bounds === null) return { kind: 'empty' };
  const plan = planTiles(bounds, tiling);
  if (plan.kind === 'work-budget-exceeded') return plan;
  const registration = registrationForGrid(tiling, plan.grid, context?.machine);
  if (typeof registration === 'string')
    return { kind: 'registration-invalid', message: registration };
  const bores =
    registration === null || context === undefined
      ? null
      : boresFor(job, plan.tiles, registration, context);
  const out: TiledJob[] = [];
  const entryReports: TileEntryReport[] = [];
  let tiledLengthMm = 0;
  for (const tile of plan.tiles) {
    const clipped = clippedTile(job, tile, bores);
    entryReports.push(...clipped.reports);
    tiledLengthMm += clipped.lengthMm;
    if (clipped.tiled !== null) out.push(clipped.tiled);
  }
  if (out.length === 0) return { kind: 'empty' };
  return readyTiles(plan.grid, out, bores, {
    entryReports,
    jobLengthMm: jobCutLengthMm(job),
    tiledLengthMm,
  });
}

function readyTiles(
  grid: EffectiveCncTileGrid,
  tiles: ReadonlyArray<TiledJob>,
  bores: TileBores | null,
  facts: Omit<Parameters<typeof tileSetAdvisories>[0], 'tiles' | 'placement' | 'holeDiameterMm'>,
): TiledJobsResult {
  const advisories = tileSetAdvisories({
    tiles,
    placement: bores?.placement ?? null,
    holeDiameterMm: bores?.registration.settings.holeDiameterMm ?? null,
    ...facts,
  });
  return { kind: 'ready', grid, tiles, ...(advisories.length === 0 ? {} : { advisories }) };
}

function boresFor(
  job: Job,
  tiles: ReadonlyArray<CncTile>,
  registration: ResolvedTileRegistration,
  context: TileContext,
): TileBores {
  const placement = placeTileRegistrationHoles(
    job,
    tiles,
    context.machine.stock,
    registration.settings.holeDiameterMm,
  );
  return { registration, context, placement };
}

type TileBores = {
  readonly registration: ResolvedTileRegistration;
  readonly context: TileContext;
  readonly placement: RegistrationPlacement;
};

function clippedTile(
  job: Job,
  tile: CncTile,
  bores: TileBores | null,
): {
  readonly tiled: TiledJob | null;
  readonly reports: ReadonlyArray<TileEntryReport>;
  readonly lengthMm: number;
} {
  const groups: CncGroup[] = [];
  const reports: TileEntryReport[] = [];
  let lengthMm = 0;
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    const clipped = clipGroupToTile(group, tile);
    if (clipped === null) continue;
    groups.push(clipped.group);
    reports.push(clipped.report);
    if (countsTowardCutLength(group)) lengthMm += clippedLengthMm(clipped.group.passes);
  }
  const holes = bores === null ? [] : registrationHolesForTile(bores.placement, tile);
  const registrationGroup =
    bores === null
      ? null
      : registrationGroupForTile(
          tile,
          holes,
          bores.registration,
          bores.context.machine,
          bores.context.device,
        );
  if (registrationGroup !== null) groups.push(registrationGroup);
  // This ordering belongs to this indexed file only; another tile may have
  // completed its profile in a separately executed file already.
  return {
    tiled: groups.length === 0 ? null : tiledJob(tile, groups, holes),
    reports,
    lengthMm,
  };
}

function tiledJob(
  tile: CncTile,
  groups: ReadonlyArray<CncGroup>,
  holes: ReadonlyArray<Vec2>,
): TiledJob {
  const registrationHoles: ReadonlyArray<TileRegistrationHole> = holes.map((stock) => ({
    stock,
    tile: { x: stock.x - tile.rect.minX, y: stock.y - tile.rect.minY },
  }));
  return {
    tile,
    job: tileLocalJob(groups),
    ...(registrationHoles.length === 0 ? {} : { registrationHoles }),
  };
}

function jobCutLengthMm(job: Job): number {
  let length = 0;
  for (const group of job.groups) {
    if (group.kind !== 'cnc' || !countsTowardCutLength(group)) continue;
    for (const pass of group.passes) length += tiledSourceLengthMm(pass);
  }
  return length;
}

// Each tile is zeroed by hand on its own frame (F-CNC19), so where that frame
// sits on the bed is unknown. A configured park is a bed position (ADR-392):
// set aside, never written as tile coordinates, so a tile parks at its own
// X0 Y0. The park height stays; it is not a bed position (ADR-491).
function tileLocalJob(groups: ReadonlyArray<CncGroup>): Job {
  return placeCncParks({ groups: orderGroupsIntoToolSections(groups) }, null);
}

function registrationForGrid(
  tiling: CncTiling,
  grid: EffectiveCncTileGrid,
  machine: CncMachineConfig | undefined,
): ResolvedTileRegistration | string | null {
  if (!tiling.registrationHoles || (grid.work.columns <= 1 && grid.work.rows <= 1)) return null;
  return resolveTileRegistration(
    tiling.registration,
    machine,
    maximumRegistrationHolesPerTile(grid),
  );
}

/**
 * The registration bores a tiled save of this job would drill, in the job's
 * own (stock) coordinates, for Preview. Null when tiling or its holes are off,
 * the grid is one tile, or the registration plan is not usable yet (the tiled
 * save then refuses and says why).
 */
export function plannedTileRegistration(
  job: Job,
  machine: CncMachineConfig,
): { readonly placement: RegistrationPlacement; readonly holeDiameterMm: number } | null {
  const tiling = machine.tiling;
  if (tiling === undefined || !tiling.registrationHoles) return null;
  const bounds = cncJobBounds(job);
  if (bounds === null) return null;
  const plan = planTiles(bounds, tiling);
  if (plan.kind === 'work-budget-exceeded') return null;
  const registration = registrationForGrid(tiling, plan.grid, machine);
  if (registration === null || typeof registration === 'string') return null;
  const holeDiameterMm = registration.settings.holeDiameterMm;
  return {
    placement: placeTileRegistrationHoles(job, plan.tiles, machine.stock, holeDiameterMm),
    holeDiameterMm,
  };
}

/** Add a one-based row and column suffix to a tiled CNC output filename. */
export function tileFileName(baseName: string, tile: CncTile): string {
  return tileFileNameForIndex(baseName, tile.row, tile.col);
}

/** Name a tile before its compiled rectangle is available (for web pickers). */
export function tileFileNameForIndex(baseName: string, row: number, col: number): string {
  return `${baseName}_tile-r${row + 1}-c${col + 1}`;
}

function cncJobBounds(job: Job): CncTile['rect'] | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    for (const pass of group.passes) {
      const points = cncPassXyPoints(pass);
      for (const point of points) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
