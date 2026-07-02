// Shared file-action handlers used by both the Toolbar buttons and the
// window-level keyboard shortcut listener (F-A15). Each function takes the
// PlatformAdapter + the store-bound callbacks it needs as arguments —
// keeps these handlers pure of React hooks, so they can be called from
// anywhere.

import { runControllerReadiness, type ControllerSettingsSnapshot } from '../../core/preflight';
import { machineKindOf, type OutputScope, type Project, type SceneObject } from '../../core/scene';
import { emitGcode } from '../../io/gcode';
import { buildGcodeMetadata } from './build-info';
import { deserializeProject, serializeProject } from '../../io/project';
import { parseSvg } from '../../io/svg';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { clearAutosave } from '../state/autosave';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import {
  DEFAULT_JOB_PLACEMENT,
  resolveJobPlacement,
  trustedMotionOffsetForPreflight,
  type JobPlacementSettings,
  type MachinePlacementSnapshot,
  type ResolvedJobPlacement,
} from '../job-placement';
import {
  describeImportError,
  describeImportResult,
  describeReimportOutcome,
} from './import-toasts';
import { importDxfFiles } from './dxf-import-action';
import { handleSaveTiledGcode } from './save-tiled-gcode';
import { detectMachineJobWarnings } from '../laser/machine-job-warnings';
import { confirmOversizeImport } from './import-size-guard';

export async function handleImportDxf(
  platform: PlatformAdapter,
  importSvgObject: (obj: SceneObject, batchIdx?: number) => ImportOutcome,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<void> {
  let files: ReadonlyArray<{ readonly name: string; readonly text: () => Promise<string> }>;
  try {
    files = await platform.pickFilesForOpen({ accept: ['.dxf'], multiple: true });
  } catch (err) {
    pushToast(`Could not import DXF: ${errMsg(err)}`, 'error');
    return;
  }
  await importDxfFiles(files, { importObject: importSvgObject, pushToast });
}

export async function handleImportSvg(
  platform: PlatformAdapter,
  importSvgObject: (obj: SceneObject, batchIdx?: number) => ImportOutcome,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<void> {
  let files: ReadonlyArray<{ readonly name: string; readonly text: () => Promise<string> }>;
  try {
    files = await platform.pickFilesForOpen({ accept: ['.svg'], multiple: true });
  } catch (err) {
    pushToast(`Could not import SVG: ${errMsg(err)}`, 'error');
    return;
  }
  let successIdx = 0;
  for (const file of files) {
    try {
      const text = await file.text();
      // F-A4 mirrors F-A3's oversize confirm. The platform FileHandle has no
      // size, so gate on the loaded text length (chars ≈ bytes for SVG).
      if (!confirmOversizeImport(file.name, text.length)) continue;
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
  readonly jobPlacement?: JobPlacementSettings;
  readonly outputScope?: OutputScope;
  readonly machine?: MachinePlacementSnapshot;
  // null = never connected this session; a snapshot = run the $30/$32
  // comparison before saving (M11). Omitted = caller doesn't track it.
  readonly controllerSettings?: ControllerSettingsSnapshot | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

export async function handleSaveGcode(ctx: SaveGcodeCtx): Promise<void> {
  // H.10: tiling-enabled CNC projects export one file per tile instead
  // (whole-job bed bounds don't apply; each tile preflights individually).
  if (
    await handleSaveTiledGcode({
      platform: ctx.platform,
      project: ctx.project,
      savedName: ctx.savedName,
      pushToast: ctx.pushToast,
    })
  ) {
    return;
  }
  // Saved exports carry a provenance header (build / commit / emitter) so a
  // stale file is obvious later. The streamed Start path intentionally omits it
  // for now (roadmap P0-A open Q2 — streamer comment handling unverified).
  const placement = resolveJobPlacement(ctx.jobPlacement ?? DEFAULT_JOB_PLACEMENT, {
    statusReport: null,
    workOriginActive: false,
    wcoCache: null,
    ...ctx.machine,
  });
  if (!placement.ok) {
    const lines = placement.messages.map((message) => `• ${message}`).join('\n');
    jobAwareAlert(`Cannot save G-code:\n\n${lines}`);
    return;
  }
  const { gcode, preflight } = emitSaveGcode(ctx, placement);
  if (!preflight.ok) {
    const lines = preflight.issues.map((i) => `• ${i.message}`).join('\n');
    jobAwareAlert(`Cannot save G-code:\n\n${lines}`);
    return;
  }
  if (!confirmControllerMismatch(ctx)) return;
  let target: SaveTarget | null;
  try {
    target = await ctx.platform.pickFileForSave({
      suggestedName: suggestedGcodeName(ctx.savedName),
      extensions: ['.gcode', '.nc'],
    });
  } catch (err) {
    ctx.pushToast(`Could not save G-code: ${errMsg(err)}`, 'error');
    return;
  }
  if (target === null) return;
  try {
    await target.write(gcode);
    ctx.pushToast(`Saved G-code to ${target.displayName}`, 'success');
    // H12 (AUDIT-2026-06-10): the saved file is valid, but the operator should
    // still see the same job-intent warnings the Start path surfaces (luma
    // upsample softer than preview, uncalibrated defaults, trace-vector cut
    // risk) — non-blocking, since the export itself succeeded. CNC mode has
    // its own advisory set (stock footprint, H.2) via the machine-aware
    // selector.
    for (const warning of detectMachineJobWarnings(ctx.project)) {
      ctx.pushToast(warning, 'warning');
    }
    if (ctx.controllerSettings === null && machineKindOf(ctx.project.machine) !== 'cnc') {
      ctx.pushToast(
        `Exported G-code assumes GRBL $30=${ctx.project.device.maxPowerS} and laser mode ($32=1) — not verified against a connected controller this session.`,
        'info',
      );
    }
  } catch (err) {
    ctx.pushToast(`Could not save G-code: ${errMsg(err)}`, 'error');
  }
}

function emitSaveGcode(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { ok: true }>,
): ReturnType<typeof emitGcode> {
  const motionOffset = trustedMotionOffsetForPreflight(ctx.project.device, placement);
  return emitGcode(ctx.project, {
    metadata: buildGcodeMetadata(),
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    ...(ctx.outputScope === undefined ? {} : { outputScope: ctx.outputScope }),
    ...(motionOffset === undefined ? {} : { preflightMotionOffset: motionOffset }),
  });
}

// M11 (AUDIT-2026-06-10): the $30 power-scale check used to protect only the
// streamed Start path. A project max S of 1000 saved for a $30=255 machine
// clamps every S>255 to 100% beam power when the file is run from an SD card
// or another sender — gate the export behind an explicit confirmation when
// the connected controller's settings disagree.
function confirmControllerMismatch(ctx: SaveGcodeCtx): boolean {
  if (ctx.controllerSettings === undefined || ctx.controllerSettings === null) return true;
  const readiness = runControllerReadiness(ctx.project, ctx.controllerSettings);
  if (readiness.ok) return true;
  const lines = readiness.errors.map((e) => `• ${e.message}`).join('\n');
  return jobAwareConfirm(
    `The exported file may not run safely on the connected controller:\n\n${lines}\n\nSave anyway?`,
  );
}

export type SaveProjectCtx = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly savedName: string | null;
  readonly lastSaveTarget: SaveTarget | null;
  readonly markSaved: (target: SaveTarget) => void;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

// LU18: the Save-before-discard flow needs to know whether the save
// actually landed — a cancelled picker must abort the destructive action
// that triggered it, not fall through to "discard anyway".
export type SaveProjectOutcome = 'saved' | 'cancelled' | 'error';

// F-A11 Save vs Save As. Without `forceDialog`, Ctrl+S reuses the in-memory
// SaveTarget from the last save (no dialog, toast just says "Saved").
// `forceDialog` = true is Save As — always prompts. New/Open clear
// lastSaveTarget so the next save will prompt regardless.
export async function handleSaveProject(
  ctx: SaveProjectCtx,
  forceDialog = false,
): Promise<SaveProjectOutcome> {
  const reuseTarget = !forceDialog && ctx.lastSaveTarget !== null;
  let target: SaveTarget | null;
  try {
    target = reuseTarget
      ? ctx.lastSaveTarget
      : await ctx.platform.pickFileForSave({
          suggestedName: ctx.savedName ?? 'untitled.lf2',
          extensions: ['.lf2'],
        });
  } catch (err) {
    ctx.pushToast(`Could not save project: ${errMsg(err)}`, 'error');
    return 'error';
  }
  if (target === null) return 'cancelled';
  try {
    await target.write(serializeProject(ctx.project));
    ctx.markSaved(target);
    // Manual save succeeded → autosave slot is redundant. Drop it so
    // the recovery prompt doesn't fire on the next boot.
    clearAutosave();
    ctx.pushToast(reuseTarget ? 'Saved' : `Saved project to ${target.displayName}`, 'success');
    return 'saved';
  } catch (err) {
    ctx.pushToast(`Could not save project: ${errMsg(err)}`, 'error');
    return 'error';
  }
}

export type OpenProjectCtx = {
  readonly platform: PlatformAdapter;
  readonly setProject: (p: Project) => void;
  readonly markLoaded: (filename: string) => void;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

export async function handleOpenProject(ctx: OpenProjectCtx): Promise<void> {
  let files: ReadonlyArray<{ readonly name: string; readonly text: () => Promise<string> }>;
  try {
    files = await ctx.platform.pickFilesForOpen({ accept: ['.lf2'], multiple: false });
  } catch (err) {
    ctx.pushToast(`Could not open project: ${errMsg(err)}`, 'error');
    return;
  }
  const file = files[0];
  if (file === undefined) return;
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    ctx.pushToast(`Could not open ${file.name}: ${errMsg(err)}`, 'error');
    return;
  }
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
    jobAwareAlert(
      `This project was saved with a newer KerfDesk (schemaVersion ${result.sawVersion}). Update the app to open it.`,
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
