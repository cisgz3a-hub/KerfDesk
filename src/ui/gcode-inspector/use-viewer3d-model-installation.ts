import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { GcodeRenderModel } from '../../core/gcode-view';
import type { Viewer3dSceneHandle } from '../viewer3d';

/** Observable lifecycle of the Inspector's current WebGL scene. */
export type Viewer3dSceneState = 'loading' | 'preparing' | 'ready' | 'no-webgl';

type Viewer3dModelInstallationArgs = {
  readonly model: GcodeRenderModel;
  readonly state: Viewer3dSceneState;
  readonly handleRef: MutableRefObject<Viewer3dSceneHandle | null>;
  readonly drawnModelRef: MutableRefObject<GcodeRenderModel | null>;
  readonly setState: Dispatch<SetStateAction<Viewer3dSceneState>>;
  readonly setReason: Dispatch<SetStateAction<string>>;
};

/** Installs each model while hidden and publishes only its completed graphics frame. */
export function useViewer3dModelInstallation(args: Viewer3dModelInstallationArgs): void {
  const { model, state, handleRef, drawnModelRef, setState, setReason } = args;
  useEffect(() => {
    if (state !== 'preparing' && state !== 'ready') return;
    if (drawnModelRef.current === model) {
      if (state === 'preparing') setState('ready');
      return;
    }
    // Commit the hidden state before submitting a replacement model's GPU work.
    if (state === 'ready') {
      setState('preparing');
      return;
    }
    const handle = handleRef.current;
    if (handle === null) return;
    const controller = new AbortController();
    // The previous completed model no longer describes the installed geometry.
    drawnModelRef.current = null;
    void (async () => {
      handle.setSegments(model);
      handle.fitToBounds(model.stats.motionBounds);
      // Let the remaining scene-sync effects apply the initial lens and markers
      // before submitting the first frame. Revision tracking still covers later changes.
      await Promise.resolve();
      if (controller.signal.aborted || handleRef.current !== handle) return;
      await handle.prepareToShow(controller.signal);
      if (controller.signal.aborted || handleRef.current !== handle) return;
      drawnModelRef.current = model;
      setState('ready');
    })().catch((error: unknown) => {
      if (controller.signal.aborted || handleRef.current !== handle) return;
      handleRef.current = null;
      handle.dispose();
      setReason(error instanceof Error ? error.message : String(error));
      setState('no-webgl');
    });
    return () => controller.abort();
  }, [drawnModelRef, handleRef, model, setReason, setState, state]);
}
