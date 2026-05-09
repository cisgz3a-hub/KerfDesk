import type { Scene } from '../core/scene/Scene';
import { deserializeScene } from './SceneSerializer';
import type {
  SceneParseWorkerRequest,
  SceneParseWorkerResponse,
} from './SceneParseWorker';

export const LARGE_PROJECT_WARN_BYTES = 50_000_000;
export const PROJECT_PARSE_WORKER_THRESHOLD_BYTES = 5_000_000;

export type ConfirmDialog = (title: string, message: string) => Promise<boolean>;

export type ProjectLoadParsePlan =
  | { kind: 'main-thread' }
  | { kind: 'worker' };

let sceneParseWorkerInstance: Worker | null = null;
let sceneParseWorkerKnownBroken = false;
let sceneParseRequestSeq = 0;

class SceneParseWorkerResponseError extends Error {}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MB`;
  return `${(mib / 1024).toFixed(1)} GB`;
}

export function shouldWarnBeforeProjectSave(estimatedBytes: number): boolean {
  return estimatedBytes > LARGE_PROJECT_WARN_BYTES;
}

export function shouldWarnBeforeProjectLoad(fileSizeBytes: number): boolean {
  return fileSizeBytes > LARGE_PROJECT_WARN_BYTES;
}

export function largeProjectSaveWarning(estimatedBytes: number): string {
  return [
    `This project will produce a file of approximately ${formatBytes(estimatedBytes)}.`,
    '',
    'Saving and loading large files takes time and may temporarily freeze the app.',
    'Consider reducing image resolution or using fewer raster objects.',
    '',
    'Continue saving?',
  ].join('\n');
}

export function largeProjectLoadWarning(fileSizeBytes: number): string {
  return [
    `This file is ${formatBytes(fileSizeBytes)}.`,
    'Loading may take 10-30 seconds and temporarily freeze the app.',
    '',
    'Continue loading?',
  ].join('\n');
}

export async function confirmLargeProjectSave(
  estimatedBytes: number,
  showConfirm: ConfirmDialog,
): Promise<boolean> {
  if (!shouldWarnBeforeProjectSave(estimatedBytes)) return true;
  return showConfirm('Large project', largeProjectSaveWarning(estimatedBytes));
}

export async function confirmLargeProjectLoad(
  fileSizeBytes: number,
  showConfirm: ConfirmDialog,
): Promise<boolean> {
  if (!shouldWarnBeforeProjectLoad(fileSizeBytes)) return true;
  return showConfirm('Large project file', largeProjectLoadWarning(fileSizeBytes));
}

export function projectLoadParsePlan(fileSizeBytes: number): ProjectLoadParsePlan {
  if (fileSizeBytes <= PROJECT_PARSE_WORKER_THRESHOLD_BYTES) {
    return { kind: 'main-thread' };
  }
  return { kind: 'worker' };
}

export async function parseSceneFile(file: Pick<File, 'size' | 'text'>): Promise<Scene> {
  const json = await file.text();
  if (projectLoadParsePlan(file.size).kind === 'worker') {
    try {
      return await parseSceneInWorker(json);
    } catch (error) {
      if (error instanceof SceneParseWorkerResponseError) throw error;
      sceneParseWorkerKnownBroken = true;
    }
  }
  return deserializeScene(json);
}

function getSceneParseWorker(): Worker | null {
  if (sceneParseWorkerKnownBroken || typeof Worker === 'undefined') return null;
  if (sceneParseWorkerInstance) return sceneParseWorkerInstance;

  try {
    sceneParseWorkerInstance = new Worker(
      new URL('./SceneParseWorker.ts', import.meta.url),
      { type: 'module' },
    );
    sceneParseWorkerInstance.addEventListener('error', () => {
      sceneParseWorkerKnownBroken = true;
    });
    return sceneParseWorkerInstance;
  } catch {
    sceneParseWorkerKnownBroken = true;
    return null;
  }
}

function parseSceneInWorker(json: string): Promise<Scene> {
  const worker = getSceneParseWorker();
  if (!worker) return Promise.reject(new Error('Scene parse worker unavailable'));

  const id = `scene-parse-${++sceneParseRequestSeq}`;
  const request: SceneParseWorkerRequest = { id, json };

  return new Promise<Scene>((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };

    const onMessage = (event: MessageEvent<SceneParseWorkerResponse>) => {
      const response = event.data;
      if (!response || response.id !== id) return;
      cleanup();
      if (response.ok) {
        resolve(response.scene);
      } else {
        reject(new SceneParseWorkerResponseError(response.error));
      }
    };

    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(`Scene parse worker error: ${event.message}`));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(request);
  });
}
