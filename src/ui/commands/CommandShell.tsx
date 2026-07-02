import { useRef, useState, type RefObject } from 'react';
import {
  generateIntervalTestGrid,
  generateMaterialTestGrid,
  generateScanOffsetCalibrationPattern,
  type IntervalTestGridOptions,
  type MaterialTestGridOptions,
  type ScanOffsetCalibrationPatternOptions,
} from '../../core/job';
import { APP_DISPLAY_NAME } from '../../core/app-branding';
import { useStore } from '../state';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useToastStore } from '../state/toast-store';
import { IntervalTestDialog } from '../calibration/IntervalTestDialog';
import { MaterialTestDialog } from '../calibration/MaterialTestDialog';
import { ScanOffsetCalibrationDialog } from '../calibration/ScanOffsetCalibrationDialog';
import { OptimizationSettingsDialog } from '../laser/OptimizationSettingsDialog';
import { AdjustImageDialog, type AdjustImageApply } from '../raster/AdjustImageDialog';
import {
  ConvertToBitmapDialog,
  type ConvertToBitmapDialogOptions,
} from '../raster/ConvertToBitmapDialog';
import { isConvertibleVector, type ConvertibleVector } from '../raster/vector-to-bitmap';
import { Toolbar } from '../common/Toolbar';
import { AppMenuBar } from './AppMenuBar';
import { CloseOpenFillContoursDialog } from './CloseOpenFillContoursDialog';
import { convertSelectedVectorToBitmap, sourceLabel } from './bitmap-conversion';
import { importImageFile } from './import-image-action';
import { runMultiFileTrace, type MultiFileTraceFile } from './multi-file-trace-action';
import { NumericEditsBar } from './NumericEditsBar';
import { ProjectNotesDialog } from './ProjectNotesDialog';
import { UndoHistoryDialog } from './UndoHistoryDialog';
import { useAppCommands } from './use-app-commands';
import { WorkspaceContextBar } from './WorkspaceContextBar';

export function CommandShell(): JSX.Element {
  const imageInput = useRef<HTMLInputElement | null>(null);
  const multiFileTraceInput = useRef<HTMLInputElement | null>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [materialTestDialogOpen, setMaterialTestDialogOpen] = useState(false);
  const [intervalTestDialogOpen, setIntervalTestDialogOpen] = useState(false);
  const [scanOffsetTestDialogOpen, setScanOffsetTestDialogOpen] = useState(false);
  const [optimizationDialogOpen, setOptimizationDialogOpen] = useState(false);
  const [projectNotesOpen, setProjectNotesOpen] = useState(false);
  const [undoHistoryOpen, setUndoHistoryOpen] = useState(false);
  const [closeToleranceDialogOpen, setCloseToleranceDialogOpen] = useState(false);
  const selectedConvertible = useSelectedConvertible();
  const selectedRaster = useSelectedRaster();
  const onImagePick = useImagePickHandler();
  const onMultiFileTracePick = useMultiFileTracePickHandler();
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const commands = useAppCommands({
    requestImportImage: () => imageInput.current?.click(),
    requestMultiFileTrace: () => multiFileTraceInput.current?.click(),
    requestConvertToBitmap: () => setConvertDialogOpen(true),
    requestAdjustImage: () => setAdjustDialogOpen(true),
    requestMaterialTest: () => setMaterialTestDialogOpen(true),
    requestIntervalTest: () => setIntervalTestDialogOpen(true),
    requestScanOffsetTest: () => setScanOffsetTestDialogOpen(true),
    requestFocusTest: () =>
      jobAwareAlert(
        'Focus Test needs a dedicated, hardware-verified Z-motion generator before it can run.',
      ),
    requestOptimizationSettings: () => setOptimizationDialogOpen(true),
    requestProjectNotes: () => setProjectNotesOpen(true),
    requestUndoHistory: () => setUndoHistoryOpen(true),
    requestCloseOpenFillContoursWithTolerance: () => setCloseToleranceDialogOpen(true),
    showAbout: () => jobAwareAlert(aboutText()),
  });
  return (
    <>
      <AppMenuBar commands={commands} machineKind={machineKind} />
      <Toolbar commands={commands} machineKind={machineKind} />
      <NumericEditsBar />
      <WorkspaceContextBar commands={commands} />
      <ImageImportInput inputRef={imageInput} onPick={onImagePick} />
      <MultiFileTraceInput inputRef={multiFileTraceInput} onPick={onMultiFileTracePick} />
      {convertDialogOpen && selectedConvertible !== null ? (
        <ConvertDialog
          convertible={selectedConvertible}
          onClose={() => setConvertDialogOpen(false)}
        />
      ) : null}
      {adjustDialogOpen && selectedRaster !== null ? (
        <AdjustDialog image={selectedRaster} onClose={() => setAdjustDialogOpen(false)} />
      ) : null}
      {materialTestDialogOpen ? (
        <MaterialDialog onClose={() => setMaterialTestDialogOpen(false)} />
      ) : null}
      {intervalTestDialogOpen ? (
        <IntervalDialog onClose={() => setIntervalTestDialogOpen(false)} />
      ) : null}
      {scanOffsetTestDialogOpen ? (
        <ScanOffsetDialog onClose={() => setScanOffsetTestDialogOpen(false)} />
      ) : null}
      {optimizationDialogOpen ? (
        <OptimizationDialog onClose={() => setOptimizationDialogOpen(false)} />
      ) : null}
      {projectNotesOpen ? <ProjectNotesPanel onClose={() => setProjectNotesOpen(false)} /> : null}
      {undoHistoryOpen ? <UndoHistoryPanel onClose={() => setUndoHistoryOpen(false)} /> : null}
      {closeToleranceDialogOpen ? (
        <CloseOpenFillContoursPanel onClose={() => setCloseToleranceDialogOpen(false)} />
      ) : null}
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

function ImageImportInput(props: {
  readonly inputRef: RefObject<HTMLInputElement>;
  readonly onPick: (file: File) => void;
}): JSX.Element {
  return (
    <input
      ref={props.inputRef}
      type="file"
      accept="image/png,image/jpeg"
      aria-label="Import image file picker"
      title="Choose a PNG or JPG image to import into the workspace."
      style={{ display: 'none' }}
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file !== undefined) props.onPick(file);
        event.target.value = '';
      }}
    />
  );
}

function MultiFileTraceInput(props: {
  readonly inputRef: RefObject<HTMLInputElement>;
  readonly onPick: (files: ReadonlyArray<MultiFileTraceFile>) => void;
}): JSX.Element {
  return (
    <input
      ref={props.inputRef}
      type="file"
      accept="image/png,image/jpeg"
      multiple
      aria-label="Multi-file trace image picker"
      title="Choose PNG or JPG images to trace into standalone SVG files."
      style={{ display: 'none' }}
      onChange={(event) => {
        props.onPick(Array.from(event.target.files ?? []));
        event.target.value = '';
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
  readonly convertible: ConvertibleVector;
  readonly onClose: () => void;
}): JSX.Element {
  const layers = useStore((s) => s.project.scene.layers);
  const convertToBitmap = useStore((s) => s.convertToBitmap);
  const pushToast = useToastStore((s) => s.pushToast);
  const onConvert = (options: ConvertToBitmapDialogOptions): void => {
    props.onClose();
    void convertSelectedVectorToBitmap(
      props.convertible,
      layers,
      options,
      convertToBitmap,
      pushToast,
    );
  };
  return (
    <ConvertToBitmapDialog
      sourceName={sourceLabel(props.convertible)}
      bounds={props.convertible.bounds}
      transform={props.convertible.transform}
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

function useMultiFileTracePickHandler(): (files: ReadonlyArray<MultiFileTraceFile>) => void {
  const pushToast = useToastStore((s) => s.pushToast);
  return (files) => {
    void runMultiFileTrace(files, pushToast);
  };
}

function useImagePickHandler(): (file: File) => void {
  const importRasterImage = useStore((s) => s.importRasterImage);
  const pushToast = useToastStore((s) => s.pushToast);
  return (file) => {
    void importImageFile(file, importRasterImage, pushToast);
  };
}

function useSelectedRaster() {
  const scene = useStore((s) => s.project.scene);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  if (selectedObjectId === null) return null;
  const selected = scene.objects.find((object) => object.id === selectedObjectId);
  return selected?.kind === 'raster-image' ? selected : null;
}

function useSelectedConvertible(): ConvertibleVector | null {
  const scene = useStore((s) => s.project.scene);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  if (selectedObjectId === null) return null;
  const selected = scene.objects.find((object) => object.id === selectedObjectId);
  return selected !== undefined && isConvertibleVector(selected) ? selected : null;
}

function aboutText(): string {
  return [
    `${APP_DISPLAY_NAME} ${__APP_VERSION__}`,
    `Commit ${__GIT_SHA__}`,
    `Built ${__BUILD_TIME__}`,
  ].join('\n');
}
