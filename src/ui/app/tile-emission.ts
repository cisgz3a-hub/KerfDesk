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
  runCncPreflight,
  type PreflightIssue,
} from '../../core/preflight';
import type { Project } from '../../core/scene';
import { gcodeMetadataHeader } from '../../io/gcode';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { ToastVariant } from '../state/toast-store';
import { buildGcodeMetadata } from './build-info';

export type TileFile = { readonly name: string; readonly gcode: string };

// The tile set plus every policy finding raised while emitting it.
export type TileEmission = {
  readonly files: ReadonlyArray<TileFile>;
  readonly advisories: ReadonlyArray<string>;
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
  tiles: ReturnType<typeof tileJobs>,
  savedName: string | null,
): TileEmission | null {
  const emitted: TileFile[] = [];
  const advisories = new Set<string>();
  for (const { tile, job } of tiles) {
    const body = cncGrblStrategy.emit(job, project.device);
    const preflight = runCncPreflight(project, machine, body);
    const blocking = preflight.issues.filter((issue) =>
      COMPILE_INTEGRITY_PREFLIGHT_CODES.has(issue.code),
    );
    if (blocking.length > 0) {
      const lines = blocking.map((issue) => `• ${issue.message}`).join('\n');
      jobAwareAlert(
        `Tile r${tile.row + 1}-c${tile.col + 1} failed preflight:\n\n${lines}\n\n` +
          'No files were written.',
      );
      return null;
    }
    for (const issue of preflight.issues) advisories.add(issue.message);
    const header = gcodeMetadataHeader(buildGcodeMetadata(), {
      kind: 'cnc',
      spindleMaxRpm: machine.params.spindleMaxRpm,
    });
    emitted.push({
      name: tileFileName(baseName(savedName), tile),
      gcode: `${header}; tile: row ${tile.row + 1}, column ${tile.col + 1}\n${body}`,
    });
  }
  return { files: emitted, advisories: [...advisories] };
}

// Rule 7 / ADR-228: neither a pre-emit nor a per-tile policy finding refuses
// the tiled export, so surface both rather than trading a refusal for silence.
// Deduped by message and reported once for the SET — an out-of-range setting
// repeats on every tile, and N identical toasts would bury the rest.
export function pushAdvisoryToasts(
  pushToast: (message: string, variant?: ToastVariant) => void,
  preEmit: ReadonlyArray<PreflightIssue> | undefined,
  perTile: ReadonlyArray<string>,
): void {
  const messages = new Set<string>([...(preEmit ?? []).map((issue) => issue.message), ...perTile]);
  for (const message of messages) {
    pushToast(message, 'warning');
  }
}

function baseName(savedName: string | null): string {
  const name = savedName ?? 'job';
  return name.replace(/\.(lf2|gcode|nc)$/i, '');
}
