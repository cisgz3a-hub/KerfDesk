/// <reference lib="webworker" />

import type { Scene } from '../core/scene/Scene';
import {
  ProjectChecksumMismatchError,
  type ProjectChecksumResult,
} from './ProjectIntegrity';
import { deserializeSceneWithIntegrity } from './SceneSerializer';

export interface SceneParseWorkerRequest {
  id: string;
  json: string;
  allowChecksumMismatch?: boolean;
}

export type SceneParseWorkerResponse =
  | { id: string; ok: true; scene: Scene }
  | {
      id: string;
      ok: false;
      error: string;
      errorKind?: 'checksum-mismatch';
      checksum?: Extract<ProjectChecksumResult, { kind: 'mismatch' }>;
    };

const ctx = self as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<SceneParseWorkerRequest>) => {
  const { id, json, allowChecksumMismatch } = event.data;
  try {
    const scene = deserializeSceneWithIntegrity(json, { allowChecksumMismatch });
    const response: SceneParseWorkerResponse = { id, ok: true, scene };
    ctx.postMessage(response);
  } catch (error) {
    if (error instanceof ProjectChecksumMismatchError) {
      const response: SceneParseWorkerResponse = {
        id,
        ok: false,
        error: error.message,
        errorKind: 'checksum-mismatch',
        checksum: error.result,
      };
      ctx.postMessage(response);
      return;
    }
    const response: SceneParseWorkerResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(response);
  }
});

export {};
