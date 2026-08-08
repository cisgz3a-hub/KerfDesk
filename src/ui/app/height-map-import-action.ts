import {
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  machineKindOf,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { pickPlatformPngFiles } from '../commands/platform-image-files';
import { prepareDepthMapPng } from '../import/depth-map-import-preparation';
import { prepareDepthMapPngOffThread } from '../import/import-worker-client';
import type { ToastVariant } from '../state/toast-store';
import { largeImportAdvisory, mainThreadImportFallbackAdvisory } from './import-size-advisory';
import { createImportWorkerControls, isImportCancellation } from './import-worker-controls';
import { DEFAULT_RELIEF_DEPTH_MM, DEFAULT_RELIEF_WIDTH_MM } from './relief-import-defaults';

type ReliefDepthMap = NonNullable<ReliefObject['depthMap']>;

type HeightMapImportContext = {
  readonly project: Project;
  readonly importObject: (object: SceneObject, batchIndex?: number) => unknown;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

export async function handleImportHeightMaps(
  platform: PlatformAdapter,
  context: HeightMapImportContext,
): Promise<void> {
  await importHeightMapFiles(await pickPlatformPngFiles(platform), context);
}

export async function importHeightMapFiles(
  files: ReadonlyArray<File>,
  context: HeightMapImportContext,
): Promise<void> {
  let successIndex = 0;
  for (const file of files) {
    const advisory = largeImportAdvisory(file.name, file.size);
    if (advisory !== null) context.pushToast(advisory, 'warning');
    const controls = createImportWorkerControls(file.name, context.pushToast);
    try {
      const pending = prepareDepthMapPngOffThread(file, controls.options);
      const prepared =
        pending === null
          ? await prepareOnMainThread(file, context.pushToast, controls.options.signal)
          : await pending;
      if (prepared.kind === 'error') {
        context.pushToast(`${file.name}: ${prepared.reason}`, 'error');
        continue;
      }
      context.importObject(reliefFromDepthMap(file.name, prepared.depthMap), successIndex);
      successIndex += 1;
      const laserNote =
        machineKindOf(context.project.machine) === 'laser'
          ? ' It is stored now and becomes output geometry in CNC mode.'
          : '';
      context.pushToast(
        `Imported height map "${file.name}" (${prepared.depthMap.width}x${prepared.depthMap.height}, ` +
          `light is high) at ${DEFAULT_RELIEF_WIDTH_MM} mm wide x ${DEFAULT_RELIEF_DEPTH_MM} mm deep.` +
          laserNote,
        'success',
      );
    } catch (error) {
      const cancelled = isImportCancellation(error);
      context.pushToast(
        cancelled
          ? `${file.name}: import cancelled.`
          : `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
        cancelled ? 'warning' : 'error',
      );
    } finally {
      controls.dispose();
    }
  }
}

async function prepareOnMainThread(
  file: File,
  pushToast: HeightMapImportContext['pushToast'],
  signal: AbortSignal | undefined,
) {
  pushToast(mainThreadImportFallbackAdvisory(file.name), 'warning');
  return prepareDepthMapPng(file, signal === undefined ? {} : { signal });
}

function reliefFromDepthMap(source: string, depthMap: ReliefDepthMap): ReliefObject {
  const heightMm = DEFAULT_RELIEF_WIDTH_MM * (depthMap.height / depthMap.width);
  return {
    kind: 'relief',
    id: crypto.randomUUID(),
    source,
    depthMap,
    targetWidthMm: DEFAULT_RELIEF_WIDTH_MM,
    reliefDepthMm: DEFAULT_RELIEF_DEPTH_MM,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: DEFAULT_RELIEF_WIDTH_MM, maxY: heightMm },
    transform: IDENTITY_TRANSFORM,
  };
}
