// handleSaveTiledGcode — the H.10 per-tile export path (F-CNC19). When the
// CNC machine has tiling enabled, Save G-code splits the compiled job into
// the indexed tile grid and saves ONE FILE PER TILE (sequential save
// dialogs, suggested names carry the r/c index). The whole-job bed-bounds
// preflight is deliberately skipped — an oversized job is the point of
// tiling — and each tile's G-code preflights individually instead.

import { tileFileName, tileJobs } from '../../core/cnc';
import { runCncPreflight } from '../../core/preflight';
import { cncGrblStrategy } from '../../core/output';
import { prepareOutput } from '../../io/gcode';
import type { PlatformAdapter } from '../../platform/types';
import type { OutputScope, Project } from '../../core/scene';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { ToastVariant } from '../state/toast-store';

const GCODE_EXTENSIONS = ['.gcode', '.nc'];

export type SaveTiledGcodeCtx = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly savedName: string | null;
  // "Cut selected graphics" applies to tiled exports too — ignoring it would
  // silently tile the whole scene.
  readonly outputScope?: OutputScope;
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
  const saved = await saveTileFiles(ctx, emitted);
  ctx.pushToast(
    saved === emitted.length
      ? `Saved all ${saved} tile files. Cut them in index order, re-registering the stock between tiles.`
      : `Saved ${saved} of ${emitted.length} tile files.`,
    saved === emitted.length ? 'success' : 'warning',
  );
  return true;
}

type TileFile = { readonly name: string; readonly gcode: string };

// Every tile must pass preflight BEFORE any file is written (the
// no-partial-output invariant applies to the whole tile set). null = a
// tile failed; the user already saw the alert.
function emitTileFiles(
  ctx: SaveTiledGcodeCtx,
  machine: Extract<Project['machine'], { kind: 'cnc' }>,
  tiles: ReturnType<typeof tileJobs>,
): TileFile[] | null {
  const emitted: TileFile[] = [];
  for (const { tile, job } of tiles) {
    const gcode = cncGrblStrategy.emit(job, ctx.project.device);
    const preflight = runCncPreflight(ctx.project, machine, gcode);
    if (!preflight.ok) {
      const lines = preflight.issues.map((issue) => `• ${issue.message}`).join('\n');
      jobAwareAlert(
        `Tile r${tile.row + 1}-c${tile.col + 1} failed preflight:\n\n${lines}\n\n` +
          'No files were written.',
      );
      return null;
    }
    emitted.push({ name: tileFileName(baseName(ctx.savedName), tile), gcode });
  }
  return emitted;
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
