// Message contract between the CNC 3D carve pane and its own worker.
//
// Deliberately separate from preparation-worker-protocol.ts (ADR-244), which
// serves the 2D preview and the ETA badge. The pane gets its own worker so a
// V-carve rebuild of the 3D grid cannot queue behind — or delay — the work the
// rest of the app depends on, and so nothing else in the app waits on it.

import type { OutputScope, Project } from '../../core/scene';
import type { DesignCarveSource } from '../design-studio/preview3d/design-carve-source';
import type { DesignSimulateResult } from '../design-studio/preview3d/design-simulate';
import type { DesignSceneSource } from './use-cnc-3d-scene';

export type DesignSceneWorkerRequestPayload =
  | {
      readonly kind: 'scene';
      readonly project: Project;
      readonly outputScope: OutputScope;
    }
  | {
      readonly kind: 'simulation';
      readonly project: Project;
      readonly source: DesignCarveSource;
    };

export type DesignSceneWorkerRequest = DesignSceneWorkerRequestPayload & {
  readonly id: number;
};

export type DesignSceneWorkerResponse =
  // `source` is null when the pane has nothing to draw — a laser project, an
  // over-budget scene, or a job whose toolpath is empty. That is a normal
  // outcome, not a failure, and the pane simply stays empty.
  | { readonly id: number; readonly kind: 'scene'; readonly source: DesignSceneSource | null }
  | { readonly id: number; readonly kind: 'simulation'; readonly result: DesignSimulateResult }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };

export type DesignSceneWorkerSuccessResponse = Exclude<
  DesignSceneWorkerResponse,
  { readonly kind: 'error' }
>;
