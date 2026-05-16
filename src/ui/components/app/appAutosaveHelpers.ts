import type { Scene } from '../../../core/scene/Scene';
import { hashSceneForPersistence } from '../../../core/scene/sceneDirtyHash';
import { serializeForAutosave } from '../../../io/SceneSerializer';

export interface AutosaveRunningJobInput {
  appJobRunning: boolean;
  controllerJobRunning: boolean;
}

export interface AutosaveHashInput {
  currentHash: string;
  lastAutosaveHash: string;
}

export type AutosavePayloadPlan =
  | { kind: 'skip-unchanged'; currentHash: string }
  | { kind: 'persist'; currentHash: string; json: string }
  | { kind: 'serialize-error'; error: unknown };

/**
 * T2-6 Phase 3ak: pure autosave skip/persist decisions.
 * App.tsx still owns interval lifecycle, scene hashing, serialization, and
 * persistence side effects.
 */
export function shouldSkipAutosaveForRunningJob(input: AutosaveRunningJobInput): boolean {
  return input.appJobRunning || input.controllerJobRunning;
}

export function shouldPersistAutosaveForHash(input: AutosaveHashInput): boolean {
  return input.currentHash !== input.lastAutosaveHash;
}

/**
 * T2-6 Phase 3as: autosave payload preparation. App.tsx still owns
 * timer lifecycle and storage writes; this helper owns hash comparison
 * and serialization so the root component carries only the side effects.
 */
export function buildAutosavePayloadPlan(input: {
  scene: Scene;
  lastAutosaveHash: string;
}): AutosavePayloadPlan {
  try {
    const currentHash = hashSceneForPersistence(input.scene);
    if (!shouldPersistAutosaveForHash({ currentHash, lastAutosaveHash: input.lastAutosaveHash })) {
      return { kind: 'skip-unchanged', currentHash };
    }

    return {
      kind: 'persist',
      currentHash,
      json: serializeForAutosave(input.scene),
    };
  } catch (error: unknown) {
    return { kind: 'serialize-error', error };
  }
}
