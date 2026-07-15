// Shared file-action handlers used by both the Toolbar buttons and the
// window-level keyboard shortcut listener (F-A15). Each function takes the
// PlatformAdapter + the store-bound callbacks it needs as arguments —
// keeps these handlers pure of React hooks, so they can be called from
// anywhere.

import { selectControllerDriver } from '../../core/controllers';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import { machineKindOf, type OutputScope, type Project, type SceneObject } from '../../core/scene';
import { emitGcodeSnapshot } from '../../io/gcode';
import { buildGcodeMetadata } from './build-info';
import { deserializeProject, prepareProjectForPersistence } from '../../io/project';
import { importLightBurnProject } from '../../io/lightburn';
import { parseSvg } from '../../io/svg';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { clearAutosave } from '../state/autosave';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { ImportOutcome } from '../state/store';
import type { ProjectMachineCapabilityLoadResult } from '../state/project-machine-capability';
import type { ToastVariant } from '../state/toast-store';
import { repairedMachineCapabilityMessage } from '../machine/machine-capability-messages';
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
import { confirmControllerReadiness } from './confirm-controller-readiness';
import { detectMachineJobWarnings } from '../laser/machine-job-warnings';
import { confirmOversizeImport } from './import-size-guard';
import { renderVariableText } from '../text/render-variable-text';
import { currentPrintCutOutputRegistration } from '../laser/print-cut-output';
import { importSourceSizeIssue } from './import-source-limits';

export async function handleImportDxf(
  platform: PlatformAdapter,
  importSvgObject: (obj: SceneObject, batchIdx?: number) => ImportOutcome,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<void> {
  let files: ReadonlyArray<{
    readonly name: string;
    readonly size?: number;
    readonly text: () => Promise<string>;
  }>;
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
  let files: ReadonlyArray<{
    readonly name: string;
    readonly size?: number;
    readonly text: () => Promise<string>;
  }>;
  try {
    files = await platform.pickFilesForOpen({ accept: ['.svg'], multiple: true });
  } catch (err) {
    pushToast(`Could not import SVG: ${errMsg(err)}`, 'error');
    return;
  }
  let successIdx = 0;
  for (const file of files) {
    try {
      // F-A4 oversize confirm. Gate on the file size BEFORE reading when the
      // adapter supplies it, so a huge file can't OOM the tab before the user is
      // asked; adapters without size fall back to the post-read length gate.
      if (file.size !== undefined && !confirmOversizeImport(file.name, file.size)) continue;
      const text = await file.text();
      if (file.size === undefined && !confirmOversizeImport(file.name, text.length)) continue;
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
  readonly allowRotaryRaster?: boolean;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly advanceVariablesAfter?: (expectedProject: Project, trigger: 'successful-export') => void;
};

export async function handleSaveGcode(ctx: SaveGcodeCtx): Promise<void> {
  // H.10: tiling-enabled CNC projects export one file per tile instead
  // (whole-job bed bounds don't apply; each tile preflights individually).
  if (
    await handleSaveTiledGcode({
      platform: ctx.platform,
      project: ctx.project,
      savedName: ctx.savedName,
      ...(ctx.outputScope === undefined ? {} : { outputScope: ctx.outputScope }),
      ...(ctx.controllerSettings === undefined
        ? {}
        : { controllerSettings: ctx.controllerSettings }),
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
  // File-only transports export a binary job instead of G-code text (ADR-097:
  // Ruida .rd today). Route on the driver capability, not `controllerKind ===
  // 'ruida'` — ADR-094 bans kind checks in ui/, and LaserWindow's sibling gate
  // already keys on transport. selectControllerDriver normalizes an unknown kind.
  if (
    selectControllerDriver(ctx.project.device.controllerKind).capabilities.transport === 'file-only'
  ) {
    const { handleSaveRd } = await import('./save-rd-action');
    await handleSaveRd(ctx, placement);
    return;
  }
  const { gcode, preflight } = await emitSaveGcode(ctx, placement);
  if (!preflight.ok) {
    const lines = preflight.issues.map((i) => `• ${i.message}`).join('\n');
    jobAwareAlert(`Cannot save G-code:\n\n${lines}`);
    return;
  }
  if (!confirmControllerReadiness(ctx.project, ctx.controllerSettings)) return;
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
    advanceExportVariables(ctx);
    ctx.pushToast(`Saved G-code to ${target.displayName}`, 'success');
    pushPostSaveAdvisories(ctx);
  } catch (err) {
    ctx.pushToast(`Could not save G-code: ${errMsg(err)}`, 'error');
  }
}

function advanceExportVariables(ctx: SaveGcodeCtx): void {
  if (ctx.advanceVariablesAfter === undefined) return;
  ctx.advanceVariablesAfter(ctx.project, 'successful-export');
}

// H12 (AUDIT-2026-06-10): the saved file is valid, but the operator should
// still see the same job-intent warnings the Start path surfaces (luma
// upsample softer than preview, uncalibrated defaults, trace-vector cut
// risk) — non-blocking, since the export itself succeeded. CNC mode has
// its own advisory set (stock footprint, H.2) via the machine-aware selector.
function pushPostSaveAdvisories(ctx: SaveGcodeCtx): void {
  for (const warning of detectMachineJobWarnings(ctx.project, ctx.controllerSettings)) {
    ctx.pushToast(warning, 'warning');
  }
  if (ctx.controllerSettings === null && machineKindOf(ctx.project.machine) !== 'cnc') {
    ctx.pushToast(
      `Exported G-code assumes GRBL $30=${ctx.project.device.maxPowerS} and laser mode ($32=1) — not verified against a connected controller this session.`,
      'info',
    );
  }
}

async function emitSaveGcode(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { ok: true }>,
): ReturnType<typeof emitGcodeSnapshot> {
  const motionOffset = trustedMotionOffsetForPreflight(ctx.project.device, placement);
  const registration = currentPrintCutOutputRegistration(ctx.project);
  return emitGcodeSnapshot(ctx.project, {
    clock: () => new Date(),
    renderVariableText,
    ...(registration === undefined ? {} : { registration }),
    metadata: buildGcodeMetadata(),
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    ...(ctx.outputScope === undefined ? {} : { outputScope: ctx.outputScope }),
    ...(motionOffset === undefined ? {} : { preflightMotionOffset: motionOffset }),
    ...(ctx.allowRotaryRaster === true ? { allowRotaryRaster: true } : {}),
  });
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
  const prepared = prepareProjectForPersistence(ctx.project);
  if (prepared.kind !== 'ok') {
    ctx.pushToast(`Could not save project: ${prepared.reason}`, 'error');
    return 'error';
  }
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
    await target.write(prepared.json);
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
  readonly setProject: (p: Project) => ProjectMachineCapabilityLoadResult;
  readonly markLoaded: (filename: string, options?: { readonly dirty?: boolean }) => void;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

export async function handleOpenProject(ctx: OpenProjectCtx): Promise<void> {
  let files: ReadonlyArray<{
    readonly name: string;
    readonly size?: number;
    readonly text: () => Promise<string>;
  }>;
  try {
    files = await ctx.platform.pickFilesForOpen({
      accept: ['.lf2', '.lbrn', '.lbrn2'],
      multiple: false,
    });
  } catch (err) {
    ctx.pushToast(`Could not open project: ${errMsg(err)}`, 'error');
    return;
  }
  const file = files[0];
  if (file === undefined) return;
  const sizeIssue = importSourceSizeIssue(
    file,
    /\.lbrn2?$/i.test(file.name) ? 'lightburn-project' : 'native-project',
  );
  if (sizeIssue !== null) {
    ctx.pushToast(`Could not open ${file.name}: ${sizeIssue}`, 'error');
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    ctx.pushToast(`Could not open ${file.name}: ${errMsg(err)}`, 'error');
    return;
  }
  if (/\.lbrn2?$/i.test(file.name)) {
    openLightBurnMigration(ctx, file.name, text);
    return;
  }
  const result = deserializeProject(text);
  if (result.kind === 'ok') {
    const loadResult = ctx.setProject(result.project);
    markCapabilityAwareLoad(ctx, file.name, loadResult);
    // Opening a real .lf2 makes any autosaved snapshot stale.
    clearAutosave();
    if (result.migratedFrom !== undefined) {
      ctx.pushToast(`Opened ${file.name} — migrated from schema v${result.migratedFrom}`, 'info');
    } else {
      ctx.pushToast(`Opened ${file.name}`, 'success');
    }
    reportMachineCapabilityRepair(loadResult, ctx.pushToast);
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

function openLightBurnMigration(ctx: OpenProjectCtx, fileName: string, text: string): void {
  const result = importLightBurnProject(text, fileName);
  if (!result.ok) {
    ctx.pushToast(`Could not import ${fileName}: ${result.reason}`, 'error');
    return;
  }
  const loadResult = ctx.setProject(result.project);
  markCapabilityAwareLoad(ctx, fileName.replace(/\.lbrn2?$/i, '.lf2'), loadResult);
  clearAutosave();
  const unsupported = result.report.unsupportedShapeTypes.length;
  const warnings = result.report.warnings.length;
  ctx.pushToast(
    `Imported ${fileName}: ${result.report.importedObjects} objects, ${result.report.importedLayers} layers${unsupported + warnings === 0 ? '' : `, ${unsupported + warnings} warning(s)`}. Save as .lf2 to keep changes.`,
    unsupported + warnings === 0 ? 'success' : 'warning',
  );
  reportMachineCapabilityRepair(loadResult, ctx.pushToast);
}

function reportMachineCapabilityRepair(
  result: ProjectMachineCapabilityLoadResult,
  pushToast: OpenProjectCtx['pushToast'],
): void {
  if (result.kind !== 'capability-repaired') return;
  pushToast(repairedMachineCapabilityMessage(result.activeKind, result.preservedCnc), 'warning');
}

function markCapabilityAwareLoad(
  ctx: OpenProjectCtx,
  filename: string,
  result: ProjectMachineCapabilityLoadResult,
): void {
  if (result.kind === 'capability-repaired') ctx.markLoaded(filename, { dirty: true });
  else ctx.markLoaded(filename);
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
