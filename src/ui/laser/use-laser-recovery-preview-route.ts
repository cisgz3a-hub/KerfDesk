import { useEffect, useState } from 'react';
import type { ExecutionArtifactV1 } from '../state/recovery';
import {
  peekLaserRecoveryPreviewRoute,
  prepareLaserRecoveryPreviewRoute,
  prepareLaserRecoveryPreviewRouteNow,
  type RecoveryPreviewRoute,
} from './laser-recovery-preview-route';

export type LaserRecoveryPreviewState =
  | { readonly status: 'preparing'; readonly route: null; readonly message: '' }
  | { readonly status: 'ready'; readonly route: RecoveryPreviewRoute; readonly message: '' }
  | { readonly status: 'failed'; readonly route: null; readonly message: string };

const PREPARING: LaserRecoveryPreviewState = { status: 'preparing', route: null, message: '' };

function failure(error: unknown): LaserRecoveryPreviewState {
  return {
    status: 'failed',
    route: null,
    message: error instanceof Error ? error.message : String(error),
  };
}

function immediateState(artifact: ExecutionArtifactV1): LaserRecoveryPreviewState {
  try {
    const route =
      peekLaserRecoveryPreviewRoute(artifact) ?? prepareLaserRecoveryPreviewRouteNow(artifact);
    return route === null ? PREPARING : { status: 'ready', route, message: '' };
  } catch (error) {
    return failure(error);
  }
}

/** Mount one instance per artifact (key it by run). A cached or worker-less
 * route renders on the first pass; otherwise the worker result arrives later
 * while the numeric line field stays usable. */
export function useLaserRecoveryPreviewRoute(
  artifact: ExecutionArtifactV1,
): LaserRecoveryPreviewState {
  const [state, setState] = useState<LaserRecoveryPreviewState>(() => immediateState(artifact));
  useEffect(() => {
    if (state.status !== 'preparing') return undefined;
    let active = true;
    prepareLaserRecoveryPreviewRoute(artifact).then(
      (route) => {
        if (active) setState({ status: 'ready', route, message: '' });
      },
      (error: unknown) => {
        if (active) setState(failure(error));
      },
    );
    return () => {
      active = false;
    };
  }, [artifact, state.status]);
  return state;
}
