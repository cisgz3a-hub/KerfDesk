import type { SvgArtworkFragment } from '../state/svg-fragment-mutation';
import type { SceneObject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { captureImportDocumentOwner } from './import-dispatch';
import { importDxfFiles } from './dxf-import-action';
import { importSvgFiles } from './svg-import-action';

type PushToast = (message: string, variant?: ToastVariant) => void;

export function canReimportSelectedArtwork(
  object: SceneObject,
): object is Extract<SceneObject, { kind: 'imported-svg' | 'raster-image' }> {
  if (object.kind !== 'imported-svg' && object.kind !== 'raster-image') return false;
  if (object.kind === 'imported-svg' && object.libraryProvenance !== undefined) return false;
  const source = object.source.toLowerCase();
  return source.endsWith('.svg') || source.endsWith('.dxf');
}

export async function handleReimportSelectedArtwork(args: {
  readonly platform: PlatformAdapter;
  readonly target: Extract<SceneObject, { kind: 'imported-svg' | 'raster-image' }>;
  readonly getSourceObjects?: () => readonly SceneObject[];
  readonly reimportFragment?: (
    targetId: string,
    fragment: SvgArtworkFragment,
  ) => ImportOutcome | null;
  readonly getProjectDocumentEpoch: () => number;
  readonly getTargetObject: () => SceneObject | undefined;
  readonly reimportObject: (targetId: string, object: SceneObject) => ImportOutcome | null;
  readonly pushToast: PushToast;
}): Promise<void> {
  const documentOwner = captureImportDocumentOwner(args.getProjectDocumentEpoch);
  const sourceIsCurrent = captureSourceObjects(args.getSourceObjects);
  const ownerIsCurrent = (): boolean =>
    documentOwner.isCurrent() && args.getTargetObject() === args.target && sourceIsCurrent();
  let committed = false;
  const pushToast: PushToast = (message, variant) => {
    if (documentOwner.isCurrent() && (committed || ownerIsCurrent()))
      args.pushToast(message, variant);
  };
  const extension = args.target.source.toLowerCase().endsWith('.dxf') ? '.dxf' : '.svg';
  let files: Awaited<ReturnType<PlatformAdapter['pickFilesForOpen']>>;
  try {
    files = await args.platform.pickFilesForOpen({ accept: [extension], multiple: false });
  } catch (error) {
    pushToast(`Could not re-import ${args.target.source}: ${messageOf(error)}`, 'error');
    return;
  }
  if (!ownerIsCurrent()) return;
  const file = files[0];
  if (file === undefined) return;
  if (!file.name.toLowerCase().endsWith(extension)) {
    pushToast(`Could not re-import: choose a ${extension.toUpperCase()} source file.`, 'error');
    return;
  }
  const replaceTarget = (object: SceneObject): ImportOutcome => {
    if (!ownerIsCurrent()) throw new Error('the selected source owner changed');
    const outcome = args.reimportObject(args.target.id, object);
    if (outcome === null) {
      throw new Error('the selected source object changed or no longer exists');
    }
    committed = true;
    return outcome;
  };
  if (extension === '.dxf') {
    await importDxfFiles([file], { importObject: replaceTarget, pushToast });
    return;
  }
  await importSvgFiles(
    [file],
    replaceTarget,
    pushToast,
    args.reimportFragment === undefined
      ? {}
      : {
          importFragment: (fragment) => {
            if (!ownerIsCurrent()) throw new Error('The selected source owner changed.');
            const singleton = fragment.objects.length === 1 ? fragment.objects[0] : undefined;
            // Legacy single-vector sources retain the established colour-based
            // operation reconciliation when their source geometry changes.
            const outcome =
              args.target.svgImport === undefined &&
              args.target.kind === 'imported-svg' &&
              singleton?.kind === 'imported-svg'
                ? args.reimportObject(args.target.id, singleton)
                : args.reimportFragment?.(args.target.id, fragment);
            if (outcome === null || outcome === undefined)
              throw new Error('The selected source artwork changed or no longer exists.');
            committed = true;
            return outcome;
          },
        },
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function captureSourceObjects(
  getSourceObjects: (() => readonly SceneObject[]) | undefined,
): () => boolean {
  const sourceObjects = getSourceObjects?.();
  return () => {
    const current = getSourceObjects?.();
    return (
      sourceObjects === undefined ||
      (current?.length === sourceObjects.length &&
        current.every((object, index) => object === sourceObjects[index]))
    );
  };
}
