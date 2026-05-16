import type { Scene } from '../../../core/scene/Scene';
import { hashSceneForPersistence } from '../../../core/scene/sceneDirtyHash';
import type { SceneTransactionMeta, SceneTransactionReason } from '../../scene/SceneTransaction';

export type ProjectLoadSource = Extract<SceneTransactionReason, { kind: 'load' }>['source'];

export interface ProjectLoadCommitPlan {
  cleanHash: string;
  reason: Extract<SceneTransactionReason, { kind: 'load' }>;
  meta: Required<Pick<SceneTransactionMeta, 'selectionAfter'>>;
}

/**
 * T2-6 Phase 3at: project-load baseline planning. App.tsx still owns
 * ref writes and commit dispatch; this helper owns the loaded-scene hash
 * and canonical load-transaction metadata.
 */
export function buildProjectLoadCommitPlan(
  scene: Scene,
  source: ProjectLoadSource,
): ProjectLoadCommitPlan {
  return {
    cleanHash: hashSceneForPersistence(scene),
    reason: { kind: 'load', source },
    meta: {
      selectionAfter: new Set(),
    },
  };
}
