import { useState } from 'react';
import {
  generateIntervalTestGrid,
  generateMaterialTestGrid,
  generateScanOffsetCalibrationPattern,
  type IntervalTestGridOptions,
  type MaterialTestGridOptions,
  type ScanOffsetCalibrationPatternOptions,
} from '../../core/job';
import { APP_DISPLAY_NAME } from '../../core/app-branding';
import { CONNECTION_HELP_TEXT } from '../help/connection-help';
import { SAFETY_NOTICE_TEXT } from '../help/safety-notice';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { BoxGeneratorHost } from '../box/BoxGeneratorHost';
import { BoxFitTestHost } from '../box/BoxFitTestHost';
import { useToastStore, type ToastVariant } from '../state/toast-store';
import { IntervalTestDialog } from '../calibration/IntervalTestDialog';
import { MaterialTestDialog } from '../calibration/MaterialTestDialog';
import { ScanOffsetCalibrationDialog } from '../calibration/ScanOffsetCalibrationDialog';
import { OptimizationSettingsDialog } from '../laser/OptimizationSettingsDialog';
import { LabsSettingsDialog } from '../laser/LabsSettingsDialog';
import { AdjustImageDialog, type AdjustImageApply } from '../raster/AdjustImageDialog';
import {
  ConvertToBitmapDialog,
  type ConvertToBitmapDialogOptions,
} from '../raster/ConvertToBitmapDialog';
import {
  bitmapConversionTarget,
  conversionSourceLabel,
  type ConvertibleVector,
} from '../raster/vector-to-bitmap';
import { usePlatform } from '../app/platform-context';
import { Toolbar } from '../common/Toolbar';
import { AppMenuBar } from './AppMenuBar';
import { CloseOpenFillContoursDialog } from './CloseOpenFillContoursDialog';
import { convertSelectedVectorsToBitmap } from './bitmap-conversion';
import { importImageFile } from './import-image-action';
import { runMultiFileTrace, writeTraceSvgFileWithPlatform } from './multi-file-trace-action';
import { NumericEditsBar } from './NumericEditsBar';
import { pickPlatformImageFile, pickPlatformImageFiles } from './platform-image-files';
import { ProjectNotesDialog } from './ProjectNotesDialog';
import { selectedConvertibleVectors, selectedObjectIds } from './selection-command-state';
import { UndoHistoryDialog } from './UndoHistoryDialog';
import { useAppCommands } from './use-app-commands';
import { WorkspaceContextBar } from './WorkspaceContextBar';

export function CommandShell(): JSX.Element {
  // Convert-to-Bitmap open state lives in the ui-store (not local state) so
  // the Ctrl/Cmd+Shift+B shortcut in use-shortcuts can open it too.
  const convertDialogOpen = useUiStore((s) => s.convertBitmapDialogOpen);
  const openConvertBitmapDialog = useUiStore((s) => s.openConvertBitmapDialog);
  const closeConvertBitmapDialog = useUiStore((s) => s.closeConvertBitmapDialog);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [boxGeneratorOpen, setBoxGeneratorOpen] = useState(false);
  const [boxFitTestOpen, setBoxFitTestOpen] = useState(false);
  const [materialTestDialogOpen, setMaterialTestDialogOpen] = useState(false);
  const [intervalTestDialogOpen, setIntervalTestDialogOpen] = useState(false);
  const [scanOffsetTestDialogOpen, setScanOffsetTestDialogOpen] = useState(false);
  const [optimizationDialogOpen, setOptimizationDialogOpen] = useState(false);
  const [labsDialogOpen, setLabsDialogOpen] = useState(false);
  const [projectNotesOpen, setProjectNotesOpen] = useState(false);
  const [undoHistoryOpen, setUndoHistoryOpen] = useState(false);
  const [closeToleranceDialogOpen, setCloseToleranceDialogOpen] = useState(false);
  const selectedConvertibles = useSelectedConvertibles();
  const selectedRaster = useSelectedRaster();
  const onImagePick = useImagePickHandler();
  const onMultiFileTracePick = useMultiFileTracePickHandler();
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const commands = useAppCommands({
    requestImportImage: onImagePick,
    requestMultiFileTrace: onMultiFileTracePick,
    requestConvertToBitmap: openConvertBitmapDialog,
    requestAdjustImage: () => setAdjustDialogOpen(true),
    requestBoxGenerator: () => setBoxGeneratorOpen(true),
    requestBoxFitTest: () => setBoxFitTestOpen(true),
    requestMaterialTest: () => setMaterialTestDialogOpen(true),
    requestIntervalTest: () => setIntervalTestDialogOpen(true),
    requestScanOffsetTest: () => setScanOffsetTestDialogOpen(true),
    requestFocusTest: () =>
      jobAwareAlert(
        'Focus Test needs a dedicated, hardware-verified Z-motion generator before it can run.',
      ),
    requestOptimizationSettings: () => setOptimizationDialogOpen(true),
    requestLabsSettings: () => setLabsDialogOpen(true),
    requestProjectNotes: () => setProjectNotesOpen(true),
    requestUndoHistory: () => setUndoHistoryOpen(true),
    requestCloseOpenFillContoursWithTolerance: () => setCloseToleranceDialogOpen(true),
    showAbout: () => jobAwareAlert(aboutText()),
    showConnectionHelp: () => jobAwareAlert(CONNECTION_HELP_TEXT),
    showSafety: () => jobAwareAlert(SAFETY_NOTICE_TEXT),
  });
  return (
    <>
      <AppMenuBar commands={commands} machineKind={machineKind} />
      <Toolbar commands={commands} machineKind={machineKind} />
      <NumericEditsBar />
      <WorkspaceContextBar commands={commands} />
      {convertDialogOpen && selectedConvertibles.length > 0 ? (
        <ConvertDialog convertibles={selectedConvertibles} onClose={closeConvertBitmapDialog} />
      ) : null}
      {adjustDialogOpen && selectedRaster !== null ? (
        <AdjustDialog image={selectedRaster} onClose={() => setAdjustDialogOpen(false)} />
      ) : null}
      <GeneratorDialogs
        boxOpen={boxGeneratorOpen}
        onBoxClose={() => setBoxGeneratorOpen(false)}
        fitTestOpen={boxFitTestOpen}
        onFitTestClose={() => setBoxFitTestOpen(false)}
        materialOpen={materialTestDialogOpen}
        onMaterialClose={() => setMaterialTestDialogOpen(false)}
        intervalOpen={intervalTestDialogOpen}
        onIntervalClose={() => setIntervalTestDialogOpen(false)}
        scanOffsetOpen={scanOffsetTestDialogOpen}
        onScanOffsetClose={() => setScanOffsetTestDialogOpen(false)}
      />
      {optimizationDialogOpen ? (
        <OptimizationDialog onClose={() => setOptimizationDialogOpen(false)} />
      ) : null}
      {labsDialogOpen ? <LabsSettingsDialog onClose={() => setLabsDialogOpen(false)} /> : null}
      {projectNotesOpen ? <ProjectNotesPanel onClose={() => setProjectNotesOpen(false)} /> : null}
      {undoHistoryOpen ? <UndoHistoryPanel onClose={() => setUndoHistoryOpen(false)} /> : null}
      {closeToleranceDialogOpen ? (
        <CloseOpenFillContoursPanel onClose={() => setCloseToleranceDialogOpen(false)} />
      ) : null}
    </>
  );
}

// The four scene-generator dialog mounts, grouped so CommandShell itself
// stays inside the complexity cap.
function GeneratorDialogs(props: {
  readonly boxOpen: boolean;
  readonly onBoxClose: () => void;
  readonly fitTestOpen: boolean;
  readonly onFitTestClose: () => void;
  readonly materialOpen: boolean;
  readonly onMaterialClose: () => void;
  readonly intervalOpen: boolean;
  readonly onIntervalClose: () => void;
  readonly scanOffsetOpen: boolean;
  readonly onScanOffsetClose: () => void;
}): JSX.Element {
  return (
    <>
      {props.boxOpen ? <BoxGeneratorHost onClose={props.onBoxClose} /> : null}
      {props.fitTestOpen ? <BoxFitTestHost onClose={props.onFitTestClose} /> : null}
      {props.materialOpen ? <MaterialDialog onClose={props.onMaterialClose} /> : null}
      {props.intervalOpen ? <IntervalDialog onClose={props.onIntervalClose} /> : null}
      {props.scanOffsetOpen ? <ScanOffsetDialog onClose={props.onScanOffsetClose} /> : null}
    </>
  );
}

function CloseOpenFillContoursPanel(props: { readonly onClose: () => void }): JSX.Element {
  const project = useStore((s) => s.project);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const closeWithTolerance = useStore((s) => s.closeSelectedOpenFillContoursWithTolerance);
  const pushToast = useToastStore((s) => s.pushToast);
  return (
    <CloseOpenFillContoursDialog
      project={project}
      selectedObjectId={selectedObjectId}
      additionalSelectedIds={additionalSelectedIds}
      onCancel={props.onClose}
      onApply={(toleranceMm) => {
        closeWithTolerance(toleranceMm);
        props.onClose();
        pushToast(`Closed Fill contours within ${toleranceMm} mm.`, 'success');
      }}
    />
  );
}

function UndoHistoryPanel(props: { readonly onClose: () => void }): JSX.Element {
  const current = useStore((s) => s.project);
  const undoStack = useStore((s) => s.undoStack);
  const redoStack = useStore((s) => s.redoStack);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  return (
    <UndoHistoryDialog
      current={current}
      undoStack={undoStack}
      redoStack={redoStack}
      onUndo={undo}
      onRedo={redo}
      onClose={props.onClose}
    />
  );
}

function ProjectNotesPanel(props: { readonly onClose: () => void }): JSX.Element {
  const notes = useStore((s) => s.project.notes);
  const setProjectNotes = useStore((s) => s.setProjectNotes);
  const pushToast = useToastStore((s) => s.pushToast);
  return (
    <ProjectNotesDialog
      notes={notes}
      onCancel={props.onClose}
      onApply={(next) => {
        setProjectNotes(next);
        props.onClose();
        pushToast('Updated project notes.', 'success');
      }}
    />
  );
}

function OptimizationDialog(props: { readonly onClose: () => void }): JSX.Element {
  const settings = useStore((s) => s.project.optimization);
  const setProjectOptimization = useStore((s) => s.setProjectOptimization);
  const pushToast = useToastStore((s) => s.pushToast);
  return (
    <OptimizationSettingsDialog
      settings={settings}
      onCancel={props.onClose}
      onApply={(patch) => {
        setProjectOptimization(patch);
        props.onClose();
        pushToast('Updated optimization settings.', 'success');
      }}
    />
  );
}

function IntervalDialog(props: { readonly onClose: () => void }): JSX.Element {
  const replaceSceneWithGeneratedScene = useStore((s) => s.replaceSceneWithGeneratedScene);
  const pushToast = useToastStore((s) => s.pushToast);
  const onGenerate = (options: IntervalTestGridOptions): void => {
    const grid = generateIntervalTestGrid(options);
    replaceSceneWithGeneratedScene(grid.scene);
    props.onClose();
    pushToast(`Generated interval test grid (${grid.cells.length} swatches).`, 'success');
  };
  return <IntervalTestDialog onCancel={props.onClose} onGenerate={onGenerate} />;
}

function MaterialDialog(props: { readonly onClose: () => void }): JSX.Element {
  const replaceSceneWithGeneratedScene = useStore((s) => s.replaceSceneWithGeneratedScene);
  const pushToast = useToastStore((s) => s.pushToast);
  const onGenerate = (options: MaterialTestGridOptions): void => {
    const grid = generateMaterialTestGrid(options);
    replaceSceneWithGeneratedScene(grid.scene);
    props.onClose();
    pushToast(`Generated material test grid (${grid.cells.length} cells).`, 'success');
  };
  return <MaterialTestDialog onCancel={props.onClose} onGenerate={onGenerate} />;
}

function ScanOffsetDialog(props: { readonly onClose: () => void }): JSX.Element {
  const replaceSceneWithGeneratedScene = useStore((s) => s.replaceSceneWithGeneratedScene);
  const pushToast = useToastStore((s) => s.pushToast);
  const onGenerate = (options: ScanOffsetCalibrationPatternOptions): void => {
    const pattern = generateScanOffsetCalibrationPattern(options);
    replaceSceneWithGeneratedScene(pattern.scene);
    props.onClose();
    pushToast(`Generated scan offset test (${pattern.cells.length} swatches).`, 'success');
  };
  return <ScanOffsetCalibrationDialog onCancel={props.onClose} onGenerate={onGenerate} />;
}

function ConvertDialog(props: {
  readonly convertibles: ReadonlyArray<ConvertibleVector>;
  readonly onClose: () => void;
}): JSX.Element {
  const layers = useStore((s) => s.project.scene.layers);
  const convertToBitmap = useStore((s) => s.convertToBitmap);
  const pushToast = useToastStore((s) => s.pushToast);
  const onConvert = (options: ConvertToBitmapDialogOptions): void => {
    props.onClose();
    void convertSelectedVectorsToBitmap(
      props.convertibles,
      layers,
      options,
      convertToBitmap,
      pushToast,
    );
  };
  // The selection's combined rotation-aware AABB + IDENTITY — exactly the
  // target the builder rasterizes, so the size estimate always matches.
  const target = bitmapConversionTarget(props.convertibles);
  return (
    <ConvertToBitmapDialog
      sourceName={conversionSourceLabel(props.convertibles)}
      bounds={target.bounds}
      transform={target.transform}
      onCancel={props.onClose}
      onConvert={onConvert}
    />
  );
}

function AdjustDialog(props: {
  readonly image: NonNullable<ReturnType<typeof useSelectedRaster>>;
  readonly onClose: () => void;
}): JSX.Element | null {
  const layer = useStore((s) =>
    s.project.scene.layers.find((candidate) => candidate.id === props.image.color),
  );
  const setLayerParam = useStore((s) => s.setLayerParam);
  const setRasterImageAdjustments = useStore((s) => s.setRasterImageAdjustments);
  if (layer === undefined) return null;
  const onApply = (patch: AdjustImageApply): void => {
    props.onClose();
    setRasterImageAdjustments(props.image.id, patch.imagePatch);
    setLayerParam(layer.id, patch.layerPatch);
  };
  return (
    <AdjustImageDialog
      image={props.image}
      layer={layer}
      onCancel={props.onClose}
      onApply={onApply}
    />
  );
}

function useMultiFileTracePickHandler(): () => void {
  const platform = usePlatform();
  const pushToast = useToastStore((s) => s.pushToast);
  return () => {
    void pickAndRunMultiFileTrace(platform, pushToast);
  };
}

function useImagePickHandler(): () => void {
  const platform = usePlatform();
  const importRasterImage = useStore((s) => s.importRasterImage);
  const pushToast = useToastStore((s) => s.pushToast);
  return () => {
    void pickPlatformImageFile(platform)
      .then((file) => {
        if (file === null) return;
        return importImageFile(file, importRasterImage, pushToast);
      })
      .catch((err: unknown) => {
        pushToast(`Could not choose image: ${errMsg(err)}`, 'error');
      });
  };
}

async function pickAndRunMultiFileTrace(
  platform: PlatformAdapter,
  pushToast: PushToast,
): Promise<void> {
  let files: ReadonlyArray<File>;
  try {
    files = await pickPlatformImageFiles(platform);
  } catch (err) {
    pushToast(`Could not choose trace images: ${errMsg(err)}`, 'error');
    return;
  }
  await runMultiFileTrace(files, pushToast, {
    write: (file) => writeTraceSvgFileWithPlatform(platform, file),
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type PushToast = (message: string, variant?: ToastVariant) => void;

function useSelectedRaster() {
  const scene = useStore((s) => s.project.scene);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  if (selectedObjectId === null) return null;
  const selected = scene.objects.find((object) => object.id === selectedObjectId);
  return selected?.kind === 'raster-image' ? selected : null;
}

// The whole convertible selection in scene order — empty unless EVERY
// selected object is a convertible vector (the command's gate).
function useSelectedConvertibles(): ReadonlyArray<ConvertibleVector> {
  const project = useStore((s) => s.project);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  return selectedConvertibleVectors(
    project,
    selectedObjectIds(selectedObjectId, additionalSelectedIds),
  );
}

function aboutText(): string {
  return [
    `${APP_DISPLAY_NAME} ${__APP_VERSION__}`,
    `Commit ${__GIT_SHA__}`,
    `Built ${__BUILD_TIME__}`,
    '',
    'Free and open-source under the MIT License (/eula.txt).',
    'Bundled open-source components: see /third-party-notices.txt.',
    '',
    'SAFETY: this software drives laser and CNC machinery. Verify every',
    'job (preview, simulation, or air run) before cutting, and never',
    'leave a running machine unattended.',
  ].join('\n');
}
