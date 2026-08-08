import {
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  machineKindOf,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';
import type { ReliefDepthMap } from '../../core/scene/relief';
import type { PlatformAdapter } from '../../platform/types';
import { pickPlatformPngFiles } from '../commands/platform-image-files';
import { prepareDepthMapPng } from '../import/depth-map-import-preparation';
import { prepareDepthMapPngOffThread } from '../import/import-worker-client';
import type { ToastVariant } from '../state/toast-store';
import { largeImportAdvisory, mainThreadImportFallbackAdvisory } from './import-size-advisory';
import { createImportWorkerControls, isImportCancellation } from './import-worker-controls';
import { DEFAULT_RELIEF_DEPTH_MM, DEFAULT_RELIEF_WIDTH_MM } from './relief-import-defaults';

type HeightMapImportContext = {
  readonly project: Project;
  readonly importObject: (object: SceneObject, batchIndex?: number) => unknown;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

/** Select PNG height maps, import them sequentially, and report picker failures by toast. */
export async function handleImportHeightMaps(
  platform: PlatformAdapter,
  context: HeightMapImportContext,
): Promise<void> {
  try {
    await importHeightMapFiles(await pickPlatformPngFiles(platform), context);
  } catch (error) {
    context.pushToast(
      `Could not select height maps: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}

/** Import a selected batch sequentially, reporting per-file cancellation and failures by toast. */
export async function importHeightMapFiles(
  files: ReadonlyArray<File>,
  context: HeightMapImportContext,
): Promise<void> {
  let successIndex = 0;
  for (const file of files) {
    const imported = await importHeightMapFile(file, successIndex, context);
    if (imported) successIndex += 1;
  }
}

async function importHeightMapFile(
  file: File,
  batchIndex: number,
  context: HeightMapImportContext,
): Promise<boolean> {
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
      return false;
    }
    context.importObject(reliefFromDepthMap(file.name, prepared.depthMap), batchIndex);
    reportImportSuccess(file.name, prepared.depthMap, context);
    return true;
  } catch (error) {
    reportImportFailure(file.name, error, context.pushToast);
    return false;
  } finally {
    controls.dispose();
  }
}

function reportImportSuccess(
  fileName: string,
  depthMap: ReliefDepthMap,
  context: HeightMapImportContext,
): void {
  const laserNote =
    machineKindOf(context.project.machine) === 'laser'
      ? ' It is stored now and becomes output geometry in CNC mode.'
      : '';
  context.pushToast(
    `Imported height map "${fileName}" (${depthMap.width}x${depthMap.height}, light is high) at ` +
      `${DEFAULT_RELIEF_WIDTH_MM} mm wide x ${DEFAULT_RELIEF_DEPTH_MM} mm deep.${laserNote}`,
    'success',
  );
}

function reportImportFailure(
  fileName: string,
  error: unknown,
  pushToast: HeightMapImportContext['pushToast'],
): void {
  const cancelled = isImportCancellation(error);
  const message = cancelled
    ? `${fileName}: import cancelled.`
    : `${fileName}: ${error instanceof Error ? error.message : String(error)}`;
  pushToast(message, cancelled ? 'warning' : 'error');
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
