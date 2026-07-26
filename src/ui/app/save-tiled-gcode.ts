// handleSaveTiledGcode — the H.10 per-tile export path (F-CNC19). When the
// CNC machine has tiling enabled, Save G-code splits the compiled job into
// the indexed tile grid and saves ONE FILE PER TILE (sequential save
// dialogs, suggested names carry the r/c index). The whole-job bed-bounds
// preflight is deliberately skipped — an oversized job is the point of
// tiling — and each tile's G-code preflights individually instead.

import { tileFileName, tileJobs } from '../../core/cnc';
import {
  COMPILE_INTEGRITY_PREFLIGHT_CODES,
  runCncPreflight,
  type ControllerSettingsSnapshot,
  type PreflightIssue,
} from '../../core/preflight';
import { cncGrblStrategy } from '../../core/output';
import { gcodeMetadataHeader, prepareOutput } from '../../io/gcode';
import type { PlatformAdapter } from '../../platform/types';
import type { OutputScope, Project } from '../../core/scene';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { ToastVariant } from '../state/toast-store';
import { confirmControllerReadiness } from './confirm-controller-readiness';
import { buildGcodeMetadata } from './build-info';

const GCODE_EXTENSIONS = ['.gcode', '.nc'];

export type SaveTiledGcodeCtx = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly savedName: string | null;
  // "Cut selected graphics" applies to tiled exports too — ignoring it would
  // silently tile the whole scene.
  readonly outputScope?: OutputScope;
  // The connected controller's live $$ snapshot, for the same $30/$32 readiness
  // gate the single-file Save runs (GCO-02). null/undefined = nothing to prove.
  readonly controllerSettings?: ControllerSettingsSnapshot | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

// Returns true when the tiled path handled the save (tiling enabled),
// false when the caller should run the normal single-file flow.
export async function handleSaveTiledGcode(ctx: SaveTiledGcodeCtx): Promise<boolean> {
  const machine = ctx.project.machine;
  if (machine?.kind !== 'cnc' || machine.tiling === undefined) return false;

  const prepared = prepareOutput(
    ctx.project,
    ctx.outputScope === undefined ? {} : { outputScope: ctx.outputScope },
  );
  if (!prepared.ok) {
    const lines = prepared.preflight.issues.map((issue) => `• ${issue.message}`).join('\n');
    jobAwareAlert(`Cannot export tiles:\n\n${lines}`);
    return true;
  }
  const tiles = tileJobs(prepared.job, machine.tiling);
  if (tiles.length === 0) {
    ctx.pushToast('Nothing to tile — the compiled job is empty.', 'warning');
    return true;
  }
  const emitted = emitTileFiles(ctx, machine, tiles);
  if (emitted === null) return true;
  const files = emitted.files;
  // Every tile has passed preflight and nothing is written yet — run the
  // controller-readiness gate ONCE for the whole set (a bad $30/$32 is the
  // same hazard whether the job is tiled or not). Declining writes no tiles.
  if (!confirmControllerReadiness(ctx.project, ctx.controllerSettings)) return true;
  const saved = await saveTileFiles(ctx, files);
  ctx.pushToast(
    saved === files.length
      ? `Saved all ${saved} tile files. Cut them in index order, re-registering the stock between tiles.`
      : `Saved ${saved} of ${files.length} tile files.`,
    saved === files.length ? 'success' : 'warning',
  );
  pushAdvisoryToasts(ctx, prepared.advisories, emitted.advisories);
  return true;
}

// Rule 7 / ADR-228: neither a pre-emit nor a per-tile policy finding refuses
// the tiled export, so surface both rather than trading a refusal for silence.
// Deduped by message and reported once for the SET — an out-of-range setting
// repeats on every tile, and N identical toasts would bury the rest.
// Extracted so handleSaveTiledGcode stays under the complexity cap.
function pushAdvisoryToasts(
  ctx: SaveTiledGcodeCtx,
  preEmit: ReadonlyArray<PreflightIssue> | undefined,
  perTile: ReadonlyArray<string>,
): void {
  const messages = new Set<string>([...(preEmit ?? []).map((issue) => issue.message), ...perTile]);
  for (const message of messages) {
    ctx.pushToast(message, 'warning');
  }
}

type TileFile = { readonly name: string; readonly gcode: string };

// The tile set plus every policy finding raised while emitting it.
type TileEmission = {
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
function emitTileFiles(
  ctx: SaveTiledGcodeCtx,
  machine: Extract<Project['machine'], { kind: 'cnc' }>,
  tiles: ReturnType<typeof tileJobs>,
): TileEmission | null {
  const emitted: TileFile[] = [];
  const advisories = new Set<string>();
  for (const { tile, job } of tiles) {
    const body = cncGrblStrategy.emit(job, ctx.project.device);
    const preflight = runCncPreflight(ctx.project, machine, body);
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
      name: tileFileName(baseName(ctx.savedName), tile),
      gcode: `${header}; tile: row ${tile.row + 1}, column ${tile.col + 1}\n${body}`,
    });
  }
  return { files: emitted, advisories: [...advisories] };
}

// Sequential save dialogs; a cancel stops the remaining tiles.
async function saveTileFiles(
  ctx: SaveTiledGcodeCtx,
  files: ReadonlyArray<TileFile>,
): Promise<number> {
  let saved = 0;
  for (const file of files) {
    let target;
    try {
      target = await ctx.platform.pickFileForSave({
        suggestedName: `${file.name}.nc`,
        extensions: GCODE_EXTENSIONS,
      });
    } catch (err) {
      ctx.pushToast(
        `Could not save tile: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
      return saved;
    }
    if (target === null) return saved;
    try {
      await target.write(file.gcode);
      saved += 1;
    } catch (err) {
      ctx.pushToast(
        `Could not write ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
      return saved;
    }
  }
  return saved;
}

function baseName(savedName: string | null): string {
  const name = savedName ?? 'job';
  return name.replace(/\.(lf2|gcode|nc)$/i, '');
}
