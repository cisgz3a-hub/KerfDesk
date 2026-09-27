import type { Project, RasterImage } from '../../core/scene';
import type { TraceSettingsRecord } from '../../core/scene/scene-object';
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
  openImageDialog: (
    source: RasterImage,
    options?: { readonly replaceTraceId?: string; readonly traceSettings?: TraceSettingsRecord },
  ) => void,
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
    // Reopen on the settings recorded with this trace (ADR-408).
    openImageDialog(source, {
      replaceTraceId: selected.id,
      ...(selected.traceSettings === undefined ? {} : { traceSettings: selected.traceSettings }),
    });
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
  return bakeImageMaskAction(app, selected, pushToast, {
    failure: 'Could not crop image',
    apply: (image, cropped) => {
      app.cropImage(image.id, cropped);
      pushToast(`Cropped image: ${image.source}`, 'success');
    },
  });
}

// Flatten Image Mask (ADR-480): the same bake and crop, then the mask shape
// is deleted unless it is locked or still used by another object.
export function flattenImageMaskAction(
  app: Pick<ImageCommandApp, 'project' | 'projectDocumentEpoch'> & {
    readonly flattenImageMask: (imageId: string, flattened: RasterImage) => string;
  },
  selected: SceneObject | null,
  pushToast: (message: string, kind: 'success' | 'error') => void,
): () => void {
  return bakeImageMaskAction(app, selected, pushToast, {
    failure: 'Could not flatten the image mask',
    apply: (image, flattened) => {
      const outcome = app.flattenImageMask(image.id, flattened);
      if (outcome === 'unchanged') return;
      pushToast(
        outcome === 'mask-deleted'
          ? `Flattened the mask into ${image.source} and deleted the mask shape.`
          : `Flattened the mask into ${image.source}. The mask shape stays because it is locked or still in use.`,
        'success',
      );
    },
  });
}

function bakeImageMaskAction(
  app: Pick<ImageCommandApp, 'project' | 'projectDocumentEpoch'>,
  selected: SceneObject | null,
  pushToast: (message: string, kind: 'success' | 'error') => void,
  handlers: {
    readonly failure: string;
    readonly apply: (image: RasterImage, baked: RasterImage) => void;
  },
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
      .then((baked) => {
        if (!cropOwnerIsCurrent(owner)) return;
        handlers.apply(selected, baked);
      })
      .catch((err: unknown) => {
        if (!cropOwnerIsCurrent(owner)) return;
        const message = err instanceof Error ? err.message : String(err);
        pushToast(`${handlers.failure}: ${message}`, 'error');
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
