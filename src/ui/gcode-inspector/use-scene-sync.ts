// useSceneSync — pushes the Inspector's derived view state into the 3D scene
// (ADR-255 stage 9 extraction). Both effects depend on `state` so they re-run
// once the scene finishes loading, otherwise the first playhead and the
// current lens would be dropped on the floor.

import { useEffect, type RefObject } from 'react';
import type { PlayheadMarker, Viewer3dSceneHandle } from '../viewer3d';
import type { Viewer3dSceneState } from './use-viewer3d-scene';

export function useSceneSync(args: {
  readonly handleRef: RefObject<Viewer3dSceneHandle | null>;
  readonly state: Viewer3dSceneState;
  /** Null reveals the whole program and hides the tool marker. */
  readonly playhead: PlayheadMarker | null;
  readonly colorOf: (segmentIndex: number) => readonly [number, number, number];
}): void {
  const { handleRef, state, playhead, colorOf } = args;

  useEffect(() => {
    handleRef.current?.setPlayhead(playhead);
  }, [handleRef, playhead, state]);

  useEffect(() => {
    handleRef.current?.recolor(colorOf);
  }, [handleRef, colorOf, state]);
}
