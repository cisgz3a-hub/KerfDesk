// Shared file-action handlers used by both the Toolbar buttons and the
// window-level keyboard shortcut listener (F-A15). Each function takes the
// PlatformAdapter + the store-bound callbacks it needs as arguments —
// keeps these handlers pure of React hooks, so they can be called from
// anywhere.

import type { Project, SceneObject } from '../../core/scene';
import { emitGcode } from '../../io/gcode';
import { deserializeProject, serializeProject } from '../../io/project';
import { parseSvg } from '../../io/svg';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { clearAutosave } from '../state/autosave';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import {
  describeImportError,
  describeImportResult,
  describeReimportOutcome,
} from './import-toasts';

export async function handleImportSvg(
  platform: PlatformAdapter,
  importSvgObject: (obj: SceneObject, batchIdx?: number) => ImportOutcome,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<void> {
  const files = await platform.pickFilesForOpen({ accept: ['.svg'], multiple: true });
  let successIdx = 0;
  for (const file of files) {
    try {
      const text = await file.text();
      const id = crypto.randomUUID();
      const result = parseSvg({ svgText: text, id, source: file.name });
      if (result.object !== null) {
        const outcome = importSvgObject(result.object, successIdx);
        successIdx += 1;
        if (outcome.kind === 'replaced') {
          // Phase C re-import: store recognised the source filename and
          // swapped the existing object in place, keeping layer settings
          // and transform. Toast the diff so the user sees what changed.
          const t = describeReimportOutcome(outcome);
          pushToast(t.message, t.variant);
          continue; // skip the generic "imported" toast
        }
      }
      for (const t of describeImportResult(file.name, result)) {
        pushToast(t.message, t.variant);
      }
    } catch (err) {
      const t = describeImportError(file.name, err);
      pushToast(t.message, t.variant);
      console.error(`Failed to import ${file.name}:`, err);
    }
  }
}

export type SaveGcodeCtx = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly savedName: string | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

export async function handleSaveGcode(ctx: SaveGcodeCtx): Promise<void> {
  const { gcode, preflight } = emitGcode(ctx.project);
  if (!preflight.ok) {
    const lines = preflight.issues.map((i) => `• ${i.message}`).join('\n');
    window.alert(`Cannot save G-code:\n\n${lines}`);
    return;
  }
  const target = await ctx.platform.pickFileForSave({
    suggestedName: suggestedGcodeName(ctx.savedName),
    extensions: ['.gcode', '.nc'],
  });
  if (target === null) return;
  try {
    await target.write(gcode);
    ctx.pushToast(`Saved G-code to ${target.displayName}`, 'success');
  } catch (err) {
    ctx.pushToast(`Could not save G-code: ${errMsg(err)}`, 'error');
  }
}

export type SaveProjectCtx = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly savedName: string | null;
  readonly lastSaveTarget: SaveTarget | null;
  readonly markSaved: (target: SaveTarget) => void;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

// F-A11 Save vs Save As. Without `forceDialog`, Ctrl+S reuses the in-memory
// SaveTarget from the last save (no dialog, toast just says "Saved").
// `forceDialog` = true is Save As — always prompts. New/Open clear
// lastSaveTarget so the next save will prompt regardless.
export async function handleSaveProject(ctx: SaveProjectCtx, forceDialog = false): Promise<void> {
  const reuseTarget = !forceDialog && ctx.lastSaveTarget !== null;
  const target = reuseTarget
    ? ctx.lastSaveTarget
    : await ctx.platform.pickFileForSave({
        suggestedName: ctx.savedName ?? 'untitled.lf2',
        extensions: ['.lf2'],
      });
  if (target === null) return;
  try {
    await target.write(serializeProject(ctx.project));
    ctx.markSaved(target);
    // Manual save succeeded → autosave slot is redundant. Drop it so
    // the recovery prompt doesn't fire on the next boot.
    clearAutosave();
    ctx.pushToast(reuseTarget ? 'Saved' : `Saved project to ${target.displayName}`, 'success');
  } catch (err) {
    ctx.pushToast(`Could not save project: ${errMsg(err)}`, 'error');
  }
}

export type OpenProjectCtx = {
  readonly platform: PlatformAdapter;
  readonly setProject: (p: Project) => void;
  readonly markLoaded: (filename: string) => void;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

export async function handleOpenProject(ctx: OpenProjectCtx): Promise<void> {
  const files = await ctx.platform.pickFilesForOpen({ accept: ['.lf2'], multiple: false });
  const file = files[0];
  if (file === undefined) return;
  const text = await file.text();
  const result = deserializeProject(text);
  if (result.kind === 'ok') {
    ctx.setProject(result.project);
    ctx.markLoaded(file.name);
    // Opening a real .lf2 makes any autosaved snapshot stale.
    clearAutosave();
    if (result.migratedFrom !== undefined) {
      ctx.pushToast(`Opened ${file.name} — migrated from schema v${result.migratedFrom}`, 'info');
    } else {
      ctx.pushToast(`Opened ${file.name}`, 'success');
    }
    return;
  }
  if (result.kind === 'schema-too-new') {
    window.alert(
      `This project was saved with a newer LaserForge (schemaVersion ${result.sawVersion}). Update the app to open it.`,
    );
    return;
  }
  ctx.pushToast(`Could not open ${file.name}: ${describeResult(result)}`, 'error');
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Derive a default G-code filename from the last-saved .lf2 name when
// possible (so saving a job from "logo.lf2" suggests "logo.gcode"), else
// fall back to "untitled.gcode".
function suggestedGcodeName(savedName: string | null): string {
  if (savedName === null) return 'untitled.gcode';
  const stem = savedName.replace(/\.(lf2|json)$/i, '');
  return `${stem}.gcode`;
}

function describeResult(
  result: Exclude<ReturnType<typeof deserializeProject>, { kind: 'ok' }>,
): string {
  if (result.kind === 'invalid') return result.reason;
  if (result.kind === 'schema-too-new') return `unsupported version ${result.sawVersion}`;
  if (result.kind === 'schema-too-old') return `legacy version ${result.sawVersion}`;
  return 'unknown error';
}
