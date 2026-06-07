import { useRef, useState } from 'react';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
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
  const selectedConvertible = useSelectedConvertible();
  const commands = useAppCommands({
    requestImportImage: () => imageInput.current?.click(),
    requestConvertToBitmap: () => setConvertDialogOpen(true),
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
    </>
  );
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
      onCancel={props.onClose}
      onConvert={onConvert}
    />
  );
}

function useImagePickHandler(): (file: File) => void {
  const importRasterImage = useStore((s) => s.importRasterImage);
  const pushToast = useToastStore((s) => s.pushToast);
  return (file) => {
    void importImageFile(file, importRasterImage, pushToast);
  };
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
