// handleSaveTiledGcode — the H.10 per-tile export path (F-CNC19). Costly
// preparation, tiling, per-tile preflight, and emission all run in the shared
// output Worker; the UI realm is limited to warnings and sequential pickers.

import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import { tileFileNameForIndex } from '../../core/cnc/tile-plan';
import type { ControllerSettingsSnapshot, ReadinessSettingsCapability } from '../../core/preflight';
import type { OutputScope, Project } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { hydratePagedRasterProject } from '../import/paged-raster-hydration';
import {
  BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE,
  prepareTiledOutputOffThread,
} from '../laser/output-preparation-worker-client';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { ToastVariant } from '../state/toast-store';
import { costlyCanvasPreparation } from '../workspace/canvas-preparation-policy';
import { controllerReadinessAdvisories } from './controller-readiness-advisories';
import type { TileFile } from './tile-emission';
import { finalizeTiledOutput, type TiledOutputPreparation } from './tiled-output-preparation';
import { tiledSaveWorkBudgetMessage } from './tiled-save-work-budget';

const GCODE_EXTENSIONS = ['.gcode', '.nc'];

export type SaveTiledGcodeCtx = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly savedName: string | null;
  readonly outputScope?: OutputScope;
  readonly controllerSettings?: ControllerSettingsSnapshot | null;
  readonly settingsCapability?: ReadinessSettingsCapability;
  readonly activeWcs?: ActiveWorkCoordinateSystem | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

// Returns true when the tiled path handled the save (tiling enabled), false
// when the caller should run the ordinary single-file flow.
export async function handleSaveTiledGcode(ctx: SaveTiledGcodeCtx): Promise<boolean> {
  const machine = ctx.project.machine;
  if (machine?.kind !== 'cnc' || machine.tiling === undefined) return false;
  return saveConfiguredTiledGcode(ctx);
}

async function saveConfiguredTiledGcode(ctx: SaveTiledGcodeCtx): Promise<true> {
  const options = ctx.outputScope === undefined ? {} : { outputScope: ctx.outputScope };
  const costly = costlyCanvasPreparation(ctx.project, options.outputScope);
  // Web file pickers consume transient user activation. Acquire the first
  // destination before a costly Worker await; subsequent per-tile pickers are
  // opened from the user's interaction with the preceding picker.
  const firstTarget = costly
    ? await pickTileTarget(ctx, suggestedFirstTileName(ctx.savedName))
    : undefined;
  if (firstTarget === null) return true;
  const preparation = await prepareTiledOutput(ctx, options);
  if (preparation === null) {
    jobAwareAlert(`Cannot export tiles:\n\n• ${BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE}`);
    return true;
  }
  if (preparation.kind === 'preparation-failed') {
    const lines = preparation.messages.map((message) => `• ${message}`).join('\n');
    jobAwareAlert(`Cannot export tiles:\n\n${lines}`);
    return true;
  }
  if (preparation.kind === 'empty') {
    ctx.pushToast('Nothing to tile — the compiled job is empty.', 'warning');
    return true;
  }
  if (preparation.kind === 'work-budget-exceeded') {
    jobAwareAlert(tiledSaveWorkBudgetMessage(preparation.grid));
    return true;
  }
  if (preparation.kind === 'tile-preflight-failed') {
    const lines = preparation.messages.map((message) => `• ${message}`).join('\n');
    jobAwareAlert(
      `Tile r${preparation.row + 1}-c${preparation.col + 1} failed preflight:\n\n${lines}\n\n` +
        'No files were written.',
    );
    return true;
  }

  for (const advisory of controllerReadinessAdvisories(
    ctx.project,
    ctx.controllerSettings,
    ctx.settingsCapability,
  )) {
    ctx.pushToast(advisory, 'warning');
  }
  pushWarnings(ctx, preparation.machineWarnings);
  pushWarnings(ctx, preparation.tileAdvisories);
  const saved = await saveTileFiles(ctx, preparation.files, firstTarget);
  ctx.pushToast(
    saved === preparation.files.length
      ? `Saved all ${saved} tile files. Cut them in index order, re-registering the stock between tiles.`
      : `Saved ${saved} of ${preparation.files.length} tile files.`,
    saved === preparation.files.length ? 'success' : 'warning',
  );
  pushWarnings(
    ctx,
    [...preparation.preparationAdvisories, ...preparation.emissionAdvisories],
    true,
  );
  return true;
}

async function prepareTiledOutput(
  ctx: SaveTiledGcodeCtx,
  options: { readonly outputScope?: OutputScope },
): Promise<TiledOutputPreparation | null> {
  if (costlyCanvasPreparation(ctx.project, options.outputScope)) {
    const background = prepareTiledOutputOffThread({
      kind: 'tiles',
      project: ctx.project,
      options,
      savedName: ctx.savedName,
      ...(ctx.controllerSettings === undefined
        ? {}
        : { controllerSettings: ctx.controllerSettings }),
      ...(ctx.activeWcs === undefined ? {} : { activeWcs: ctx.activeWcs }),
    });
    if (background === null) return null;
    try {
      return await background;
    } catch {
      return null;
    }
  }
  const hydrated = await hydratePagedRasterProject(ctx.project);
  return finalizeTiledOutput(
    prepareOutput(hydrated, options),
    ctx.savedName,
    ctx.controllerSettings ?? null,
    ctx.activeWcs ?? null,
  );
}

function pushWarnings(
  ctx: SaveTiledGcodeCtx,
  warnings: ReadonlyArray<string>,
  dedupe = false,
): void {
  for (const warning of dedupe ? new Set(warnings) : warnings) {
    ctx.pushToast(warning, 'warning');
  }
}

// Sequential save dialogs; cancelling a picker stops only the remaining files.
async function saveTileFiles(
  ctx: SaveTiledGcodeCtx,
  files: ReadonlyArray<TileFile>,
  firstTarget?: SaveTarget,
): Promise<number> {
  let saved = 0;
  for (const [index, file] of files.entries()) {
    const target =
      index === 0 && firstTarget !== undefined
        ? firstTarget
        : await pickTileTarget(ctx, `${file.name}.nc`);
    if (target === null) return saved;
    try {
      await target.write(file.gcode);
      saved += 1;
    } catch (error) {
      ctx.pushToast(
        `Could not write ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
      return saved;
    }
  }
  return saved;
}

async function pickTileTarget(
  ctx: SaveTiledGcodeCtx,
  suggestedName: string,
): Promise<SaveTarget | null> {
  try {
    return await ctx.platform.pickFileForSave({
      suggestedName,
      extensions: GCODE_EXTENSIONS,
    });
  } catch (error) {
    ctx.pushToast(
      `Could not save tile: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return null;
  }
}

function suggestedFirstTileName(savedName: string | null): string {
  const base = (savedName ?? 'job').replace(/\.(lf2|gcode|nc)$/i, '');
  return `${tileFileNameForIndex(base, 0, 0)}.nc`;
}
