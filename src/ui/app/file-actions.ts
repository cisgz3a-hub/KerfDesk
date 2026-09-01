// Shared file-action handlers used by both the Toolbar buttons and the
// window-level keyboard shortcut listener (F-A15). Each function takes the
// PlatformAdapter + the store-bound callbacks it needs as arguments —
// keeps these handlers pure of React hooks, so they can be called from
// anywhere.

import { selectControllerDriver } from '../../core/controllers';
import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import type {
  ControllerSettingsSnapshot,
  PreflightIssue,
  ReadinessSettingsCapability,
} from '../../core/preflight';
import {
  DEFAULT_OUTPUT_SCOPE,
  machineKindOf,
  validateOutputScope,
  type OutputScope,
  type Project,
  type SceneObject,
} from '../../core/scene';
import type { deserializeProject } from '../../io/project';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { requestSaveFilename } from '../state/save-filename-store';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import {
  type JobPlacementSettings,
  type MachinePlacementSnapshot,
  type resolveExportJobPlacement,
} from '../job-placement';
import { importDxfFiles } from './dxf-import-action';
import { handleSaveTiledGcode } from './save-tiled-gcode';
import { controllerReadinessAdvisories } from './controller-readiness-advisories';
import { importSourceSizeAdvisory } from './import-size-advisory';
import { prepareGcodeSave } from './prepare-gcode-save';
import { detectCompiledVCarveDepthWarnings } from '../laser/cnc-compiled-depth-warnings';
import { parseOpenedProjectFile, type OpenProjectFile } from './project-open-parser';
import { importSvgFiles } from './svg-import-action';
import { createImportWorkerControls, isImportCancellation } from './import-worker-controls';
import { saveGcodePlacement, type PrebuiltGcodeSave } from './transactional-gcode-save';
import { errorMessage, suggestedGcodeName } from './file-action-formatters';
import {
  completeLightBurnProjectOpen,
  completeNativeProjectOpen,
  type ProjectOpenCompletionContext,
} from './project-open-completion';
import { claimProjectOpenRequest } from './project-open-request-owner';
import {
  bindImportActionsToDocument,
  captureImportDocumentOwner,
  type ImportDispatchActions,
} from './import-dispatch';

export {
  ordinaryGcodeSaveUsesPrebuiltDialog,
  prebuildGcodeSave,
  type PrebuiltGcodeSave,
} from './transactional-gcode-save';
export { handleSaveProject, type SaveProjectCtx } from './project-save-action';
export {
  SAVE_COMPLETED_WITH_NEWER_EDITS_MESSAGE,
  type SaveProjectOutcome,
} from './project-save-completion';

export async function handleImportDxf(
  platform: PlatformAdapter,
  importSvgObject: (obj: SceneObject, batchIdx?: number) => ImportOutcome,
  pushToast: (message: string, variant?: ToastVariant) => void,
  getProjectDocumentEpoch: () => number,
): Promise<void> {
  const actions = vectorImportActions(importSvgObject, pushToast, getProjectDocumentEpoch);
  const owner = captureImportDocumentOwner(getProjectDocumentEpoch);
  const ownedActions = bindImportActionsToDocument(actions, owner);
  let files: ReadonlyArray<{
    readonly name: string;
    readonly size?: number;
    readonly text: () => Promise<string>;
    readonly blob?: () => Promise<Blob>;
  }>;
  try {
    files = await platform.pickFilesForOpen({ accept: ['.dxf'], multiple: true });
  } catch (err) {
    ownedActions.pushToast(`Could not import DXF: ${errorMessage(err)}`, 'error');
    return;
  }
  if (!owner.isCurrent()) return;
  await importDxfFiles(files, {
    importObject: ownedActions.importSvgObject,
    pushToast: ownedActions.pushToast,
  });
}

export async function handleImportSvg(
  platform: PlatformAdapter,
  importSvgObject: (obj: SceneObject, batchIdx?: number) => ImportOutcome,
  pushToast: (message: string, variant?: ToastVariant) => void,
  getProjectDocumentEpoch: () => number,
): Promise<void> {
  const actions = vectorImportActions(importSvgObject, pushToast, getProjectDocumentEpoch);
  const owner = captureImportDocumentOwner(getProjectDocumentEpoch);
  const ownedActions = bindImportActionsToDocument(actions, owner);
  let files: ReadonlyArray<{
    readonly name: string;
    readonly size?: number;
    readonly text: () => Promise<string>;
    readonly blob?: () => Promise<Blob>;
  }>;
  try {
    files = await platform.pickFilesForOpen({ accept: ['.svg'], multiple: true });
  } catch (err) {
    ownedActions.pushToast(`Could not import SVG: ${errorMessage(err)}`, 'error');
    return;
  }
  if (!owner.isCurrent()) return;
  await importSvgFiles(files, ownedActions.importSvgObject, ownedActions.pushToast);
}

function vectorImportActions(
  importSvgObject: (obj: SceneObject, batchIdx?: number) => ImportOutcome,
  pushToast: (message: string, variant?: ToastVariant) => void,
  getProjectDocumentEpoch: () => number,
): ImportDispatchActions {
  return {
    getProjectDocumentEpoch,
    importSvgObject,
    importRasterImage: () => undefined,
    pushToast,
  };
}

export type SaveGcodeCtx = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly savedName: string | null;
  readonly jobPlacement?: JobPlacementSettings;
  readonly outputScope?: OutputScope;
  readonly machine?: MachinePlacementSnapshot;
  // null = never connected this session; a snapshot = report any $30/$32
  // disagreement as a warning before the picker opens (M11, demoted from a
  // confirm by rule 7 / ADR-228). Omitted = caller doesn't track it.
  readonly controllerSettings?: ControllerSettingsSnapshot | null;
  // How the active controller exposes settings. This only controls the
  // readiness advisory interpretation; Save remains non-blocking.
  readonly settingsCapability?: ReadinessSettingsCapability;
  // Operator-selected active WCS (C6): a non-G54 value warns the saved job's
  // G54 emission will mismatch a placement measured from the active offset.
  readonly activeWcs?: ActiveWorkCoordinateSystem | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly advanceVariablesAfter?: (expectedProject: Project, trigger: 'successful-export') => void;
};

function optionalSettingsCapability(
  settingsCapability: ReadinessSettingsCapability | undefined,
): Pick<SaveGcodeCtx, 'settingsCapability'> | Record<never, never> {
  return settingsCapability === undefined ? {} : { settingsCapability };
}

// exactOptionalPropertyTypes: an explicit `undefined` is not assignable to an
// optional field, so the key is omitted instead of passed through.
function optionalActiveWcs(
  activeWcs: ActiveWorkCoordinateSystem | null | undefined,
): Pick<SaveGcodeCtx, 'activeWcs'> | Record<never, never> {
  return activeWcs === undefined ? {} : { activeWcs };
}

export async function handleSaveGcode(
  ctx: SaveGcodeCtx,
  options: { readonly prebuilt?: PrebuiltGcodeSave } = {},
): Promise<void> {
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
      ...optionalSettingsCapability(ctx.settingsCapability),
      ...optionalActiveWcs(ctx.activeWcs),
      pushToast: ctx.pushToast,
    })
  ) {
    return;
  }
  // Saved exports carry a provenance header (build / commit / emitter) so a
  // stale file is obvious later. The streamed Start path intentionally omits it
  // for now (roadmap P0-A open Q2 — streamer comment handling unverified).
  // Export placement, not Start placement: a file save must stay possible
  // with no connected machine or active origin (only Current Position bakes
  // live state into the bytes — see resolveExportJobPlacement).
  if (options.prebuilt !== undefined && options.prebuilt.project !== ctx.project) {
    ctx.pushToast(
      'Could not save G-code: the prepared artifact no longer matches this project.',
      'error',
    );
    return;
  }
  const placement = options.prebuilt?.placement ?? saveGcodePlacement(ctx);
  if (placement === null) return;
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
  await saveOrdinaryGcode(ctx, placement, options.prebuilt);
}

async function saveOrdinaryGcode(
  ctx: SaveGcodeCtx,
  placement: Extract<ReturnType<typeof resolveExportJobPlacement>, { readonly ok: true }>,
  prebuilt: PrebuiltGcodeSave | undefined,
): Promise<void> {
  // Rule 7 / ADR-228: stated HERE, where the deleted confirm stood, rather than
  // with the post-save advisories. The confirm was raised on every save
  // ATTEMPT, so reporting it only after a successful write would tell the
  // operator less than the refusal did whenever the picker is cancelled.
  for (const advisory of controllerReadinessAdvisories(
    ctx.project,
    ctx.controllerSettings,
    ctx.settingsCapability,
  )) {
    ctx.pushToast(advisory, 'warning');
  }
  // Production calls this from the Choose destination button with a prebuilt
  // artifact, so the picker is invoked synchronously inside that fresh user
  // gesture. Direct/test callers without an artifact prepare first: factual
  // failure must never create, open, truncate, or modify a final target.
  const prepared = prebuilt?.prepared ?? (await prepareGcodeSave(ctx, placement));
  if (prepared.kind === 'failed') return;
  let target: SaveTarget | null;
  try {
    target = await pickGcodeDestination(ctx.platform, {
      suggestedName: suggestedGcodeName(ctx.savedName),
      extensions: ['.gcode', '.nc'],
      chooseName: requestSaveFilename,
    });
  } catch (err) {
    ctx.pushToast(`Could not save G-code: ${errorMessage(err)}`, 'error');
    return;
  }
  if (target === null) return;
  try {
    await target.write(prepared.gcode);
    advanceExportVariables(ctx);
    ctx.pushToast(`Saved G-code to ${target.displayName}`, 'success');
    pushPostSaveAdvisories(
      ctx,
      prepared.advisories,
      prepared.cncVCarveDepths,
      prepared.machineWarnings,
    );
  } catch (err) {
    ctx.pushToast(`Could not save G-code: ${errorMessage(err)}`, 'error');
  }
}

function pickGcodeDestination(
  platform: PlatformAdapter,
  request: Parameters<PlatformAdapter['pickFileForSave']>[0],
): Promise<SaveTarget | null> {
  return (platform.reserveFileForSave ?? platform.pickFileForSave)(request);
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
function pushPostSaveAdvisories(
  ctx: SaveGcodeCtx,
  preflightAdvisories: ReadonlyArray<PreflightIssue>,
  cncVCarveDepths: Parameters<typeof detectCompiledVCarveDepthWarnings>[0],
  machineWarnings: ReadonlyArray<string>,
): void {
  for (const advisory of preflightAdvisories) {
    ctx.pushToast(advisory.message, 'warning');
  }
  const warningProject = outputScopedWarningProject(ctx);
  for (const warning of machineWarnings) {
    ctx.pushToast(warning, 'warning');
  }
  if (warningProject.machine?.kind === 'cnc') {
    for (const warning of detectCompiledVCarveDepthWarnings(
      cncVCarveDepths,
      warningProject.machine.stock.thicknessMm,
    )) {
      ctx.pushToast(warning, 'warning');
    }
  }
  if (ctx.controllerSettings === null && machineKindOf(ctx.project.machine) !== 'cnc') {
    ctx.pushToast(
      `Exported G-code assumes GRBL $30=${ctx.project.device.maxPowerS} and laser mode ($32=1) — not verified against a connected controller this session.`,
      'info',
    );
  }
}

function outputScopedWarningProject(ctx: SaveGcodeCtx): Project {
  const scoped = validateOutputScope(ctx.project.scene, ctx.outputScope ?? DEFAULT_OUTPUT_SCOPE);
  if (!scoped.ok || scoped.scene === ctx.project.scene) return ctx.project;
  return { ...ctx.project, scene: scoped.scene };
}

export type OpenProjectCtx = ProjectOpenCompletionContext & {
  readonly platform: PlatformAdapter;
  readonly claimProjectOpenRequest: () => number;
  readonly getProjectOpenRequestEpoch: () => number;
  readonly getProjectDocumentEpoch: () => number;
};

export async function handleOpenProject(ctx: OpenProjectCtx): Promise<void> {
  const owner = claimProjectOpenRequest(
    ctx.pushToast,
    ctx.claimProjectOpenRequest,
    ctx.getProjectOpenRequestEpoch,
    ctx.getProjectDocumentEpoch,
  );
  const ownedCtx: OpenProjectCtx = {
    ...ctx,
    setProject: (project) => {
      const result = ctx.setProject(project);
      owner.adoptCurrentDocument();
      return result;
    },
    pushToast: owner.pushToast,
  };
  let files: ReadonlyArray<OpenProjectFile>;
  try {
    files = await ctx.platform.pickFilesForOpen({
      accept: ['.lf2', '.lbrn', '.lbrn2'],
      multiple: false,
    });
  } catch (err) {
    ownedCtx.pushToast(`Could not open project: ${errorMessage(err)}`, 'error');
    return;
  }
  if (!owner.isCurrent()) return;
  const file = files[0];
  if (file === undefined) return;
  const sizeAdvisory = importSourceSizeAdvisory(
    file,
    /\.lbrn2?$/i.test(file.name) ? 'lightburn-project' : 'native-project',
  );
  if (sizeAdvisory !== null) ownedCtx.pushToast(sizeAdvisory, 'warning');
  const controls = createImportWorkerControls(file.name, ownedCtx.pushToast);
  let result: ReturnType<typeof deserializeProject>;
  try {
    const parsed = await parseOpenedProjectFile(file, controls.options, ownedCtx.pushToast);
    if (!owner.isCurrent()) return;
    if (parsed.kind === 'lightburn') {
      completeLightBurnProjectOpen(ownedCtx, file.name, parsed.result);
      return;
    }
    result = parsed.result;
  } catch (err) {
    ownedCtx.pushToast(
      isImportCancellation(err)
        ? `${file.name}: open cancelled.`
        : `Could not open ${file.name}: ${errorMessage(err)}`,
      isImportCancellation(err) ? 'warning' : 'error',
    );
    return;
  } finally {
    controls.dispose();
  }
  if (!owner.isCurrent()) return;
  completeNativeProjectOpen(ownedCtx, file.name, result);
}
