/// <reference lib="webworker" />

import type { Scene } from '../core/scene/Scene';
import { deserializeScene } from './SceneSerializer';

export interface SceneParseWorkerRequest {
  id: string;
  json: string;
}

export type SceneParseWorkerResponse =
  | { id: string; ok: true; scene: Scene }
  | { id: string; ok: false; error: string };

const ctx = self as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<SceneParseWorkerRequest>) => {
  const { id, json } = event.data;
  try {
    const scene = deserializeScene(json);
    const response: SceneParseWorkerResponse = { id, ok: true, scene };
    ctx.postMessage(response);
  } catch (error) {
    const response: SceneParseWorkerResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(response);
  }
});

export {};
