// tile-emission — turns a tiled CNC job into the per-tile files to write, and
// decides which preflight findings may refuse that. Split out of
// save-tiled-gcode so that file stays the save-flow coordinator (dialogs,
// toasts, readiness) and this one owns emission + the rule-7 policy split.
//
// Deliberately takes primitives rather than SaveTiledGcodeCtx: importing that
// type back from save-tiled-gcode would form an import cycle.

import type { tileJobs } from '../../core/cnc';
import {
  numberTileBitFiles,
  splitTileJobByBit,
  tileBitFileName,
  tileBitHeader,
  tileSetUsesSeveralBits,
  type TileBitRun,
} from '../../core/cnc/tile-bit-files';
import { cncGrblStrategy } from '../../core/output';
import {
  COMPILE_INTEGRITY_PREFLIGHT_CODES,
  findCncSecondaryToolFeedIssues,
  hasCuttingMove,
  runCncPreflight,
} from '../../core/preflight';
import type { Job } from '../../core/job';
import type { Project } from '../../core/scene';
import { gcodeMetadataHeader } from '../../io/gcode';
import { buildGcodeMetadata } from './build-info';
import {
  compiledVCarveLayerDepths,
  detectCompiledVCarveDepthWarnings,
} from '../laser/cnc-compiled-depth-warnings';

export type TileFile = { readonly name: string; readonly gcode: string };
type ReadyTiledJobs = Extract<ReturnType<typeof tileJobs>, { readonly kind: 'ready' }>;
type CncMachine = Extract<Project['machine'], { kind: 'cnc' }>;

// ADR-392 Amendment 2: a tile that needs more than one bit is written as one
// file per bit, so no tile file holds an M0 bit change.
export const TILE_BIT_FILES_ADVISORY =
  'Tiles that need more than one bit are saved as one file per bit (…_bit-1-of-2, ' +
  "…_bit-2-of-2). Run a tile's bit files in that order without moving its X/Y zero, and " +
  'change the bit and re-zero Z on the stock top before each one. Tile files hold no M0 bit ' +
  'change, because Run G-code file sends an M0 to the controller, which then takes no jog or ' +
  'Zero Z until cycle start.';

// The tile set plus every policy finding raised while emitting it.
export type TileEmission =
  | {
      readonly kind: 'ready';
      readonly files: ReadonlyArray<TileFile>;
      readonly advisories: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'failed';
      readonly row: number;
      readonly col: number;
      readonly messages: ReadonlyArray<string>;
    };

// Every tile must clear COMPILE INTEGRITY before any file is written (the
// no-partial-output invariant applies to the whole tile set). null = a tile
// factually could not be produced; the user already saw the alert.
//
// Rule 7 / ADR-228: this used to refuse on `!preflight.ok`, but
// runCncPreflight reports heuristic policy codes (cnc-settings-invalid,
// no-go-zone-collision, plunged-travel) alongside the integrity ones — so a
// settings judgment that merely warns on Start refused the entire tiled
// export. Split against the same canonical set the Start, Save and
// prepareOutput paths key off so none of them can drift apart.
export function emitTileFiles(
  project: Project,
  machine: CncMachine,
  tiles: ReadyTiledJobs['tiles'],
  savedName: string | null,
  compiledJob: Job,
): TileEmission {
  const emitted: TileFile[] = [];
  const advisories = new Set<string>();
  const namesBits = tileSetUsesSeveralBits(tiles.map(({ job }) => job));
  for (const { tile, job } of tiles) {
    const runs = splitTileJobByBit(job).map((run) => ({
      ...run,
      body: cncGrblStrategy.emit(run.job, project.device),
    }));
    const bitFiles = numberTileBitFiles(cuttingRuns(runs));
    for (const { body, ...bitFile } of bitFiles) {
      // Reuse the scoped whole-job evidence so per-tile diagnostics never
      // re-enter V-carve planning once per tile.
      const { issues } = runCncPreflight(project, machine, body, { compiledJob });
      const blocking = issues.filter((issue) => COMPILE_INTEGRITY_PREFLIGHT_CODES.has(issue.code));
      if (blocking.length > 0) {
        return {
          kind: 'failed',
          row: tile.row,
          col: tile.col,
          messages: blocking.map((issue) => issue.message),
        };
      }
      for (const issue of issues) advisories.add(issue.message);
      emitted.push({
        name: tileBitFileName(baseName(savedName), tile, bitFile),
        gcode:
          `${tileHeader(project, machine)}; tile: row ${tile.row + 1}, column ${tile.col + 1}\n` +
          `${namesBits ? tileBitHeader(bitFile) : ''}${body}`,
      });
    }
    if (bitFiles.length > 1) advisories.add(TILE_BIT_FILES_ADVISORY);
    for (const issue of findCncSecondaryToolFeedIssues(job)) advisories.add(issue.message);
    for (const warning of detectCompiledVCarveDepthWarnings(
      compiledVCarveLayerDepths(job),
      machine.stock.thicknessMm,
    )) {
      advisories.add(warning);
    }
  }
  return { kind: 'ready', files: emitted, advisories: [...advisories] };
}

// A bit that only touches this tile at a point (a vertex on its edge clips to a
// zero-length piece, which emits no move) writes no file: there is nothing for
// it to cut, and a file without a cut would fail preflight for the whole set.
// A tile with no cut at all keeps its runs, so preflight still refuses it.
function cuttingRuns<Run extends TileBitRun & { readonly body: string }>(
  runs: ReadonlyArray<Run>,
): ReadonlyArray<Run> {
  // The same test as runCncPreflight's empty-output rule.
  const cutting = runs.filter((run) => hasCuttingMove(run.body));
  return cutting.length === 0 ? runs : cutting;
}

function tileHeader(project: Project, machine: CncMachine): string {
  return gcodeMetadataHeader(
    buildGcodeMetadata(),
    {
      kind: 'cnc',
      spindleMaxRpm: machine.params.spindleMaxRpm,
    },
    project.device,
  );
}

function baseName(savedName: string | null): string {
  const name = savedName ?? 'job';
  return name.replace(/\.(lf2|gcode|nc)$/i, '');
}
