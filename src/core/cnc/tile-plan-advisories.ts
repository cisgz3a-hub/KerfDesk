// What the tiled save tells the operator about a tile set (F-CNC19): ramp
// provenance by operation, re-planned and kept seam entries, every
// registration bore by tile, seams with too few bores, and the cutting the
// overlap strips repeat.

import type { CncGroup } from '../job';
import type { TiledJob } from './cnc-tile';
import { operationName, tileEntryAdvisories, type TileEntryReport } from './tile-clipped-entries';
import {
  TILE_REGISTRATION_LAYER_ID,
  tileLabel,
  type RegistrationPlacement,
} from './tile-registration-placement';

// Below this share of the job, the strip's repeat is not worth a line.
const OVERLAP_REPEAT_NOTICE_FRACTION = 0.01;

export function tileSetAdvisories(input: {
  readonly tiles: ReadonlyArray<TiledJob>;
  readonly entryReports: ReadonlyArray<TileEntryReport>;
  readonly placement: RegistrationPlacement | null;
  readonly holeDiameterMm: number | null;
  readonly jobLengthMm: number;
  readonly tiledLengthMm: number;
}): ReadonlyArray<string> {
  return [
    ...rampProvenanceAdvisories(input.tiles),
    ...tileEntryAdvisories(input.entryReports),
    ...(input.placement?.warnings ?? []),
    ...registrationListing(input.tiles, input.holeDiameterMm),
    ...overlapRepeatAdvisory(input.jobLengthMm, input.tiledLengthMm),
  ];
}

function rampProvenanceAdvisories(tiles: ReadonlyArray<TiledJob>): ReadonlyArray<string> {
  const names = new Set<string>();
  for (const { job } of tiles) {
    for (const group of job.groups) {
      if (group.kind === 'cnc' && group.rampEntryTiled === true) {
        names.add(operationName(group.cutType));
      }
    }
  }
  if (names.size === 0) return [];
  return [
    `Tiled ${[...names].join(', ')} ramp entries are derived as per-tile geometry. The entered ` +
      'ramp angle remains requested provenance, not a re-verified emitted maximum. Inspect each ' +
      'tile, or keep the contour wholly within one tile, when the cutter needs a guaranteed ' +
      'maximum angle.',
  ];
}

function registrationListing(
  tiles: ReadonlyArray<TiledJob>,
  holeDiameterMm: number | null,
): ReadonlyArray<string> {
  const listed = tiles.filter((entry) => (entry.registrationHoles?.length ?? 0) > 0);
  if (listed.length === 0 || holeDiameterMm === null) return [];
  const perTile = listed.map(
    ({ tile, registrationHoles }) =>
      `${tileLabel(tile)} ${(registrationHoles ?? [])
        .map(
          ({ stock, tile: local }) =>
            `(${mm(stock.x)}, ${mm(stock.y)}; tile ${mm(local.x)}, ${mm(local.y)})`,
        )
        .join(' ')}`,
  );
  return [
    `Registration holes, Ø${mm(holeDiameterMm)} mm, at stock X, Y (and tile X, Y). Each is ` +
      `clear of every part and cut and inside the stock: ${perTile.join('; ')}. Preview draws ` +
      'them; check them against your fixture before cutting.',
  ];
}

function overlapRepeatAdvisory(jobLengthMm: number, tiledLengthMm: number): ReadonlyArray<string> {
  const repeatMm = tiledLengthMm - jobLengthMm;
  if (!(jobLengthMm > 0) || !(repeatMm > jobLengthMm * OVERLAP_REPEAT_NOTICE_FRACTION)) return [];
  const percent = Math.round((repeatMm / jobLengthMm) * 100);
  return [
    `The overlap strips are cut by both tiles beside them: ${Math.round(repeatMm)} mm of ` +
      `cutting runs twice (${percent}% more than the untiled job). With exact registration ` +
      'the repeat cuts air; any registration error re-cuts those walls.',
  ];
}

function mm(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/** Groups whose cutting length counts toward the overlap repeat. */
export function countsTowardCutLength(group: CncGroup): boolean {
  return group.layerId !== TILE_REGISTRATION_LAYER_ID;
}
