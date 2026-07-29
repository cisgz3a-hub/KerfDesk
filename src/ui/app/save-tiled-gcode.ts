// handleSaveTiledGcode — the H.10 per-tile export path (F-CNC19). When the
// CNC machine has tiling enabled, Save G-code splits the compiled job into
// the indexed tile grid and saves ONE FILE PER TILE (sequential save
// dialogs, suggested names carry the r/c index). The whole-job bed-bounds
// preflight is deliberately skipped — an oversized job is the point of
// tiling — and each tile's G-code preflights individually instead.

import { tileJobs } from '../../core/cnc';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import { prepareOutput } from '../../io/gcode';
import type { PlatformAdapter } from '../../platform/types';
import type { OutputScope, Project } from '../../core/scene';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { ToastVariant } from '../state/toast-store';
import { controllerReadinessAdvisories } from './controller-readiness-advisories';
import { emitTileFiles, pushAdvisoryToasts, type TileFile } from './tile-emission';
import { tiledSaveWorkBudgetMessage } from './tiled-save-work-budget';

const GCODE_EXTENSIONS = ['.gcode', '.nc'];

export type SaveTiledGcodeCtx = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly savedName: string | null;
  // "Cut selected graphics" applies to tiled exports too — ignoring it would
  // silently tile the whole scene.
  readonly outputScope?: OutputScope;
  // The connected controller's live $$ snapshot, for the same $30/$32 readiness
  // REPORT the single-file Save makes (GCO-02, demoted from a gate by rule 7 /
  // ADR-228). null/undefined = nothing to prove.
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
  const tiled = tileJobs(prepared.job, machine.tiling);
  if (tiled.kind === 'empty') {
    ctx.pushToast('Nothing to tile — the compiled job is empty.', 'warning');
    return true;
  }
  if (tiled.kind === 'work-budget-exceeded') {
    jobAwareAlert(tiledSaveWorkBudgetMessage(tiled.grid));
    return true;
  }
  const emitted = emitTileFiles(ctx.project, machine, tiled.tiles, ctx.savedName);
  if (emitted === null) return true;
  const files = emitted.files;
  // Rule 7 / ADR-228: a disagreeing $30/$32 is the same hazard whether the job
  // is tiled or not, so it is stated ONCE for the whole set. Reported here,
  // where the deleted confirm stood — the confirm fired before any tile was
  // written, so reporting only after a successful run would say less than the
  // refusal did when the operator cancels part-way through the pickers.
  for (const advisory of controllerReadinessAdvisories(ctx.project, ctx.controllerSettings)) {
    ctx.pushToast(advisory, 'warning');
  }
  const saved = await saveTileFiles(ctx, files);
  ctx.pushToast(
    saved === files.length
      ? `Saved all ${saved} tile files. Cut them in index order, re-registering the stock between tiles.`
      : `Saved ${saved} of ${files.length} tile files.`,
    saved === files.length ? 'success' : 'warning',
  );
  pushAdvisoryToasts(ctx.pushToast, prepared.advisories, emitted.advisories);
  return true;
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
