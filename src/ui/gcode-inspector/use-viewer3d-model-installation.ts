import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { GcodeRenderModel } from '../../core/gcode-view';
import type { Viewer3dSceneHandle } from '../viewer3d';

/** Observable lifecycle of the Inspector's current WebGL scene. */
export type Viewer3dSceneState = 'loading' | 'preparing' | 'ready' | 'no-webgl';

type Viewer3dModelInstallationArgs = {
  readonly model: GcodeRenderModel;
  readonly state: Viewer3dSceneState;
  readonly handleRef: RefObject<Viewer3dSceneHandle | null>;
  readonly drawnModelRef: MutableRefObject<GcodeRenderModel | null>;
  readonly setState: Dispatch<SetStateAction<Viewer3dSceneState>>;
};

/** Installs each model once and publishes readiness only after its initial bounds land. */
export function useViewer3dModelInstallation(args: Viewer3dModelInstallationArgs): void {
  const { model, state, handleRef, drawnModelRef, setState } = args;
  useEffect(() => {
    if (state !== 'preparing' && state !== 'ready') return;
    if (drawnModelRef.current === model) {
      if (state === 'preparing') setState('ready');
      return;
    }
    handleRef.current?.setSegments(model);
    handleRef.current?.fitToBounds(model.stats.motionBounds);
    drawnModelRef.current = model;
    if (state === 'preparing') setState('ready');
  }, [drawnModelRef, handleRef, model, setState, state]);
}
