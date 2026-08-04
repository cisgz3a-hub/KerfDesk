// tile-emission — turns a tiled CNC job into the per-tile files to write, and
// decides which preflight findings may refuse that. Split out of
// save-tiled-gcode so that file stays the save-flow coordinator (dialogs,
// toasts, readiness) and this one owns emission + the rule-7 policy split.
//
// Deliberately takes primitives rather than SaveTiledGcodeCtx: importing that
// type back from save-tiled-gcode would form an import cycle.

import { tileFileName, type tileJobs } from '../../core/cnc';
import { cncGrblStrategy } from '../../core/output';
import {
  COMPILE_INTEGRITY_PREFLIGHT_CODES,
  findCncSecondaryToolFeedIssues,
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
  machine: Extract<Project['machine'], { kind: 'cnc' }>,
  tiles: ReadyTiledJobs['tiles'],
  savedName: string | null,
  compiledJob: Job,
): TileEmission {
  const emitted: TileFile[] = [];
  const advisories = new Set<string>();
  for (const { tile, job } of tiles) {
    const body = cncGrblStrategy.emit(job, project.device);
    // Reuse the scoped whole-job evidence so per-tile diagnostics never
    // re-enter V-carve planning once per tile.
    const preflight = runCncPreflight(project, machine, body, { compiledJob });
    const issues = [...preflight.issues, ...findCncSecondaryToolFeedIssues(job)];
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
    for (const warning of detectCompiledVCarveDepthWarnings(
      compiledVCarveLayerDepths(job),
      machine.stock.thicknessMm,
    )) {
      advisories.add(warning);
    }
    const header = gcodeMetadataHeader(
      buildGcodeMetadata(),
      {
        kind: 'cnc',
        spindleMaxRpm: machine.params.spindleMaxRpm,
      },
      project.device,
    );
    emitted.push({
      name: tileFileName(baseName(savedName), tile),
      gcode: `${header}; tile: row ${tile.row + 1}, column ${tile.col + 1}\n${body}`,
    });
  }
  return { kind: 'ready', files: emitted, advisories: [...advisories] };
}

function baseName(savedName: string | null): string {
  const name = savedName ?? 'job';
  return name.replace(/\.(lf2|gcode|nc)$/i, '');
}
