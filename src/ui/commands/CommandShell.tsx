import { useLayoutEffect, useRef, useState } from 'react';
import {
  generateIntervalTestGrid,
  generateMaterialTestGrid,
  type IntervalTestGridOptions,
  type MaterialTestGridOptions,
} from '../../core/job';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { IntervalTestDialog } from '../calibration/IntervalTestDialog';
import { MaterialTestDialog } from '../calibration/MaterialTestDialog';
import { OptimizationSettingsDialog } from '../laser/OptimizationSettingsDialog';
import { AdjustImageDialog, type AdjustImageApply } from '../raster/AdjustImageDialog';
import {
  ConvertToBitmapDialog,
  type ConvertToBitmapDialogOptions,
} from '../raster/ConvertToBitmapDialog';
import { isConvertibleVector, type ConvertibleVector } from '../raster/vector-to-bitmap';
import { Toolbar } from '../common/Toolbar';
import { AppMenuBar } from './AppMenuBar';
import { convertSelectedVectorToBitmap, sourceLabel } from './bitmap-conversion';
import { importImageFile } from './import-image-action';
import { useAppCommands } from './use-app-commands';

export function CommandShell(): JSX.Element {
  const imageInput = useRef<HTMLInputElement | null>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [materialTestDialogOpen, setMaterialTestDialogOpen] = useState(false);
  const [intervalTestDialogOpen, setIntervalTestDialogOpen] = useState(false);
  const [optimizationDialogOpen, setOptimizationDialogOpen] = useState(false);
  const selectedConvertible = useSelectedConvertible();
  const selectedRaster = useSelectedRaster();
  const commands = useAppCommands({
    requestImportImage: () => imageInput.current?.click(),
    requestConvertToBitmap: () => setConvertDialogOpen(true),
    requestAdjustImage: () => setAdjustDialogOpen(true),
    requestMaterialTest: () => setMaterialTestDialogOpen(true),
    requestIntervalTest: () => setIntervalTestDialogOpen(true),
    requestOptimizationSettings: () => setOptimizationDialogOpen(true),
    showAbout: () => window.alert(aboutText()),
  });
  const onImagePick = useImagePickHandler();
  return (
    <>
      <AppMenuBar commands={commands} />
      <Toolbar commands={commands} />
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) onImagePick(file);
          event.target.value = '';
        }}
      />
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
      {optimizationDialogOpen ? (
        <OptimizationDialog onClose={() => setOptimizationDialogOpen(false)} />
      ) : null}
    </>
  );
}

function OptimizationDialog(props: { readonly onClose: () => void }): JSX.Element {
  useRegisterModal();
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
  useRegisterModal();
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
  useRegisterModal();
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

function ConvertDialog(props: {
  readonly convertible: ConvertibleVector;
  readonly onClose: () => void;
}): JSX.Element {
  useRegisterModal();
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
  useRegisterModal();
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

function useRegisterModal(): void {
  const registerModal = useUiStore((s) => s.registerModal);
  const unregisterModal = useUiStore((s) => s.unregisterModal);
  useLayoutEffect(() => {
    registerModal();
    return unregisterModal;
  }, [registerModal, unregisterModal]);
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
  return [`LaserForge ${__APP_VERSION__}`, `Commit ${__GIT_SHA__}`, `Built ${__BUILD_TIME__}`].join(
    '\n',
  );
}
