import type { Project, RasterImage } from '../../core/scene';
import { cropMaskedRasterImage } from '../raster/crop-image';
import { useStore } from '../state';
import type { SelectedImageMaskPair } from './image-mask-command-state';

type SceneObject = Project['scene']['objects'][number];
type PushToast = (message: string, kind: 'success' | 'error') => void;

type ImageCommandApp = {
  readonly project: Project;
  readonly projectDocumentEpoch: number;
  readonly applyImageMask: (imageId: string, maskId: string) => void;
  readonly cropImage: (imageId: string, cropped: RasterImage) => void;
  readonly removeImageMask: (imageId: string) => void;
};

export function traceImageAction(
  selected: SceneObject | null,
  openImageDialog: (source: RasterImage) => void,
): () => void {
  return () => {
    if (selected?.kind === 'raster-image') openImageDialog(selected);
  };
}

export function traceSourceForTracedImage(
  project: Project,
  selected: SceneObject | null,
): RasterImage | null {
  if (
    (selected?.kind !== 'traced-image' && selected?.kind !== 'raster-image') ||
    selected.traceSourceId === undefined
  ) {
    return null;
  }
  const source = project.scene.objects.find((object) => object.id === selected.traceSourceId);
  return source?.kind === 'raster-image' ? source : null;
}

export function retraceOriginalAction(
  project: Project,
  selected: SceneObject | null,
  openImageDialog: (source: RasterImage, options?: { readonly replaceTraceId?: string }) => void,
  pushToast: PushToast,
): () => void {
  return () => {
    if (selected?.kind !== 'traced-image' && selected?.kind !== 'raster-image') return;
    const source = traceSourceForTracedImage(project, selected);
    if (source === null) {
      pushToast(
        `Original raster for ${selected.source} is missing. Re-trace needs the kept source image.`,
        'error',
      );
      return;
    }
    openImageDialog(source, { replaceTraceId: selected.id });
  };
}

export function applyImageMaskAction(
  app: ImageCommandApp,
  pair: SelectedImageMaskPair | null,
): () => void {
  return () => {
    if (pair !== null) app.applyImageMask(pair.imageId, pair.maskId);
  };
}

export function removeImageMaskAction(
  app: ImageCommandApp,
  selected: SceneObject | null,
): () => void {
  return () => {
    if (selected?.kind === 'raster-image') app.removeImageMask(selected.id);
  };
}

export function cropImageAction(
  app: ImageCommandApp,
  selected: SceneObject | null,
  pushToast: (message: string, kind: 'success' | 'error') => void,
): () => void {
  return () => {
    if (selected?.kind !== 'raster-image' || selected.imageMaskId === undefined) return;
    const maskObject = app.project.scene.objects.find(
      (object) => object.id === selected.imageMaskId,
    );
    if (maskObject === undefined) return;
    const owner = {
      projectDocumentEpoch: app.projectDocumentEpoch,
      sourceImage: selected,
      maskObject,
    };
    if (!cropOwnerIsCurrent(owner)) return;
    void cropMaskedRasterImage(selected, maskObject)
      .then((cropped) => {
        if (!cropOwnerIsCurrent(owner)) return;
        app.cropImage(selected.id, cropped);
        pushToast(`Cropped image: ${selected.source}`, 'success');
      })
      .catch((err: unknown) => {
        if (!cropOwnerIsCurrent(owner)) return;
        const message = err instanceof Error ? err.message : String(err);
        pushToast(`Could not crop image: ${message}`, 'error');
      });
  };
}

function cropOwnerIsCurrent(owner: {
  readonly projectDocumentEpoch: number;
  readonly sourceImage: RasterImage;
  readonly maskObject: SceneObject;
}): boolean {
  const state = useStore.getState();
  if (state.projectDocumentEpoch !== owner.projectDocumentEpoch) return false;
  const source = state.project.scene.objects.find((object) => object.id === owner.sourceImage.id);
  const mask = state.project.scene.objects.find((object) => object.id === owner.maskObject.id);
  return source === owner.sourceImage && mask === owner.maskObject;
}
