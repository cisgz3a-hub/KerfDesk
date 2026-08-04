import { useEffect, useState, type RefObject } from 'react';

export type ViewerDialogState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string };

export type ViewerDialogSceneResult =
  | { readonly kind: 'ok'; readonly handle: { readonly dispose: () => void } }
  | { readonly kind: 'no-webgl'; readonly reason: string };

export type ViewerDialogSceneBuilder = (
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  reportFailure: (reason: string) => void,
) => Promise<ViewerDialogSceneResult>;

type StoredState = {
  readonly buildScene: ViewerDialogSceneBuilder | null;
  readonly value: ViewerDialogState;
};

/** Runs one dialog scene builder and owns its cancellation/disposal lifecycle. */
export function useViewerDialogScene(
  buildScene: ViewerDialogSceneBuilder | null,
  canvasRef: RefObject<HTMLCanvasElement | null>,
): StoredState {
  const [state, setState] = useState<StoredState>({
    buildScene: null,
    value: { kind: 'loading' },
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (buildScene === null || canvas === null) return;
    let handle: { readonly dispose: () => void } | null = null;
    let isCancelled = false;
    const controller = new AbortController();
    const reportFailure = (reason: string): void => {
      if (!isCancelled) setState({ buildScene, value: { kind: 'failed', reason } });
    };
    setState({ buildScene, value: { kind: 'loading' } });
    void buildScene(canvas, controller.signal, reportFailure).then(
      (outcome) => {
        if (isCancelled) {
          if (outcome.kind === 'ok') outcome.handle.dispose();
        } else if (outcome.kind === 'ok') {
          handle = outcome.handle;
          setState({ buildScene, value: { kind: 'ready' } });
        } else {
          reportFailure(outcome.reason);
        }
      },
      (error: unknown) => {
        reportFailure(error instanceof Error ? error.message : 'The 3D renderer failed to start.');
      },
    );
    return () => {
      isCancelled = true;
      controller.abort();
      handle?.dispose();
    };
  }, [buildScene, canvasRef]);
  return state;
}
