import { cncSideProgramName } from '../../core/cnc/cnc-two-sided-setup';
import type { SvgArtworkFragment } from '../state/svg-fragment-mutation';
// Shared file-action handlers used by both the Toolbar buttons and the
// window-level keyboard shortcut listener (F-A15). Each function takes the
// PlatformAdapter + the store-bound callbacks it needs as arguments —
// keeps these handlers pure of React hooks, so they can be called from
// anywhere.

import { selectControllerDriver } from '../../core/controllers';
import type { ControllerKind, DeviceProfile } from '../../core/devices';
import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import type { ControllerSettingsSnapshot, ReadinessSettingsCapability } from '../../core/preflight';
import type { OutputScope, Project, SceneObject } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import type { ImportOutcome } from '../state/store';
import type { ToastOptions, ToastVariant } from '../state/toast-store';
import { projectLoadRefused } from '../state/project-machine-capability';
import {
  type JobPlacementSettings,
  type MachinePlacementSnapshot,
  type resolveExportJobPlacement,
} from '../job-placement';
import { importDxfFiles } from './dxf-import-action';
import { handleSaveTiledGcode } from './save-tiled-gcode';
import { advanceExportVariables } from './advance-export-variables';
import {
  controllerReadinessAdvisories,
  readinessFirmwareKind,
} from './controller-readiness-advisories';
import { cncProjectExportAdvisories } from './cnc-export-controller-advisory';
import { importSourceSizeAdvisory } from './import-size-advisory';
import { prepareGcodeSave } from './prepare-gcode-save';
import { parseOpenedProjectFile, type OpenProjectFile } from './project-open-parser';
import { importSvgFiles } from './svg-import-action';
import { createImportWorkerControls, isImportCancellation } from './import-worker-controls';
import { saveGcodePlacement, type PrebuiltGcodeSave } from './transactional-gcode-save';
import { pushSavedGcodeNotices } from './save-gcode-notices';
import { errorMessage, suggestedGcodeName } from './file-action-formatters';
import {
  completeLightBurnProjectOpen,
  completeNativeProjectOpen,
  openedProjectSaveTarget,
  type ProjectOpenCompletionContext,
} from './project-open-completion';
import { claimProjectOpenRequest } from './project-open-request-owner';
import { rememberOpenedProject } from '../recent-projects/recent-project-record';
import { chosenOrPickedProjectFiles } from './chosen-project-file';
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

export const GALVO_HAS_NO_FILE =
  'A JCZ galvo has no job file to save. Run the job from Machine details → JCZ galvo USB connection: Frame with the red light, then Start.';
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
  importSvgFragment?: (fragment: SvgArtworkFragment, batchIndex?: number) => ImportOutcome,
): Promise<void> {
  const actions = {
    ...vectorImportActions(importSvgObject, pushToast, getProjectDocumentEpoch),
    ...(importSvgFragment === undefined ? {} : { importSvgFragment }),
  };
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
  await importSvgFiles(
    files,
    ownedActions.importSvgObject,
    ownedActions.pushToast,
    ownedActions.importSvgFragment === undefined
      ? {}
      : { importFragment: ownedActions.importSvgFragment },
  );
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
  readonly pushToast: (message: string, variant?: ToastVariant, options?: ToastOptions) => void;
  readonly advanceVariablesAfter?: (
    expectedProject: Project,
    trigger: 'successful-export',
    outputScope?: OutputScope,
  ) => void;
};

function optionalSettingsCapability(
  settingsCapability: ReadinessSettingsCapability | undefined,
): Pick<SaveGcodeCtx, 'settingsCapability'> | Record<never, never> {
  return settingsCapability === undefined ? {} : { settingsCapability };
}

function optionalFirmwareKind(
  firmwareKind: ControllerKind | undefined,
): { readonly firmwareKind: ControllerKind } | Record<never, never> {
  return firmwareKind === undefined ? {} : { firmwareKind };
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
      ...optionalFirmwareKind(readinessFirmwareKind(ctx.machine)),
      ...optionalActiveWcs(ctx.activeWcs),
      pushToast: ctx.pushToast,
      ...(ctx.advanceVariablesAfter === undefined
        ? {}
        : { advanceVariablesAfter: ctx.advanceVariablesAfter }),
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
  if (await savedWithoutGcode(ctx, placement)) return;
  await saveOrdinaryGcode(ctx, placement, options.prebuilt);
}

// File-only transports export a binary job instead of G-code text (ADR-097:
// Ruida .rd; ADR-703: Lihuiyu .egv). Route on the driver capability, not
// `controllerKind` — ADR-094 bans kind checks in ui/, and LaserWindow's sibling
// gate already keys on transport. selectControllerDriver normalizes an unknown
// kind. True when the save was handled here.
async function savedWithoutGcode(
  ctx: SaveGcodeCtx,
  placement: Extract<ReturnType<typeof resolveExportJobPlacement>, { readonly ok: true }>,
): Promise<boolean> {
  const driver = selectControllerDriver(ctx.project.device.controllerKind);
  // A JCZ galvo has no job file (ADR-704): it runs over its USB link.
  if (driver.galvoUsb !== undefined) {
    ctx.pushToast(GALVO_HAS_NO_FILE, 'error');
    return true;
  }
  // A USB-link controller with no file format (ADR-705: Moshiboard) has
  // nothing to save: its programs exist only on the link. A USB-link driver
  // that names a fileFormat (ADR-703: Lihuiyu .egv) saves that file instead.
  if (driver.usbLink !== undefined && driver.fileFormat === undefined) {
    ctx.pushToast(
      `${driver.label} has no job file to save. Run the job from Machine details over its USB link.`,
      'warning',
    );
    return true;
  }
  if (driver.capabilities.transport !== 'file-only') return false;
  if (driver.fileFormat === 'egv') {
    const { handleSaveEgv } = await import('./save-egv-action');
    await handleSaveEgv(ctx, placement);
    return true;
  }
  const { handleSaveRd } = await import('./save-rd-action');
  await handleSaveRd(ctx, placement);
  return true;
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
  for (const advisory of [
    ...controllerReadinessAdvisories(
      ctx.project,
      ctx.controllerSettings,
      ctx.settingsCapability,
      readinessFirmwareKind(ctx.machine),
    ),
    ...cncProjectExportAdvisories(ctx.project),
  ]) {
    ctx.pushToast(advisory, 'warning');
  }
  // Production calls this from the Save as button with a prebuilt
  // artifact, so the picker is invoked synchronously inside that fresh user
  // gesture. Direct/test callers without an artifact prepare first: factual
  // failure must never create, open, truncate, or modify a final target.
  const prepared = prebuilt?.prepared ?? (await prepareGcodeSave(ctx, placement));
  if (prepared.kind === 'failed') return;
  let target: SaveTarget | null;
  try {
    // Preparation is complete, so use the normal Save As dialog. A directory
    // reservation adds a second filename prompt and restricts folder choices.
    target = await ctx.platform.pickFileForSave({
      suggestedName: cncSideProgramName(suggestedGcodeName(ctx.savedName), ctx.project),
      extensions: ['.gcode', '.nc'],
    });
  } catch (err) {
    ctx.pushToast(`Could not save G-code: ${errorMessage(err)}`, 'error');
    return;
  }
  if (target === null) return;
  try {
    await target.write(prepared.gcode);
    advanceExportVariables(ctx);
    pushSavedGcodeNotices(ctx, target.displayName, {
      preflightAdvisories: prepared.advisories,
      cncVCarveDepths: prepared.cncVCarveDepths,
      machineWarnings: prepared.machineWarnings,
      ...(prepared.cncProgramFacts === undefined
        ? {}
        : { cncToolPlanLength: prepared.cncProgramFacts.toolPlan.length }),
    });
  } catch (err) {
    ctx.pushToast(`Could not save G-code: ${errorMessage(err)}`, 'error');
  }
}

export type OpenProjectCtx = ProjectOpenCompletionContext & {
  readonly platform: PlatformAdapter;
  readonly claimProjectOpenRequest: () => number;
  readonly getProjectOpenRequestEpoch: () => number;
  readonly getProjectDocumentEpoch: () => number;
  /** Current immutable revision; edits during the picker/parser retire publication. */
  readonly getProject?: () => Project;
  /** Rechecked after asynchronous reading/parsing, immediately before replacing the document. */
  readonly stillAllowed?: () => boolean;
  /** The machine open now. A LightBurn project opens on it (ADR-388); without
   * it, on the default machine. */
  readonly currentDevice?: () => DeviceProfile;
};

/** Open a project from the picker, or `chosenFile` when the operator already
 * chose it (Recent Projects, or a file the operating system handed over). */
export async function handleOpenProject(
  ctx: OpenProjectCtx,
  chosenFile?: OpenProjectFile,
): Promise<void> {
  const owner = claimProjectOpenRequest(
    ctx.pushToast,
    ctx.claimProjectOpenRequest,
    ctx.getProjectOpenRequestEpoch,
    ctx.getProjectDocumentEpoch,
    ctx.getProject,
  );
  const ownedCtx: OpenProjectCtx = {
    ...ctx,
    setProject: (project) => {
      const result = ctx.setProject(project);
      if (!projectLoadRefused(result)) owner.adoptCurrentDocument();
      return result;
    },
    pushToast: owner.pushToast,
  };
  let files: ReadonlyArray<OpenProjectFile>;
  try {
    files = await chosenOrPickedProjectFiles(chosenFile, () =>
      ctx.platform.pickFilesForOpen({
        accept: ['.lf2', '.lbrn', '.lbrn2'],
        multiple: false,
      }),
    );
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
  let parsed: Awaited<ReturnType<typeof parseOpenedProjectFile>>;
  try {
    parsed = await parseOpenedProjectFile(
      file,
      controls.options,
      ownedCtx.pushToast,
      ctx.currentDevice,
    );
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
  if (!owner.isCurrent() || ctx.stillAllowed?.() === false) return;
  completeOpenedFile(ownedCtx, file, parsed);
}

function completeOpenedFile(
  ctx: OpenProjectCtx,
  file: OpenProjectFile,
  parsed: Awaited<ReturnType<typeof parseOpenedProjectFile>>,
): void {
  const opened =
    parsed.kind === 'lightburn'
      ? completeLightBurnProjectOpen(ctx, file.name, parsed.result)
      : completeNativeProjectOpen(
          ctx,
          file.name,
          parsed.result,
          openedProjectSaveTarget(ctx.platform, file.recentRef),
        );
  rememberOpenedProject(ctx.platform, file, opened);
}
