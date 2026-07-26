// useSceneSync — pushes the Inspector's derived view state into the 3D scene
// (ADR-255 stage 9 extraction). Both effects depend on `state` so they re-run
// once the scene finishes loading, otherwise the first playhead and the
// current lens would be dropped on the floor.

import { useEffect, type RefObject } from 'react';
import type { ArrowPlacement, PlayheadMarker, Viewer3dSceneHandle } from '../viewer3d';
import type { Viewer3dSceneState } from './use-viewer3d-scene';

export function useSceneSync(args: {
  readonly handleRef: RefObject<Viewer3dSceneHandle | null>;
  readonly state: Viewer3dSceneState;
  /** Null reveals the whole program and hides the tool marker. */
  readonly playhead: PlayheadMarker | null;
  readonly colorOf: (segmentIndex: number) => readonly [number, number, number];
  /** Live machine position from controller status; null hides the marker. */
  readonly live: { readonly x: number; readonly y: number; readonly z: number } | null;
  /** Direction arrowheads, or null when the overlay is off. */
  readonly arrows: ReadonlyArray<ArrowPlacement> | null;
}): void {
  const { handleRef, state, playhead, colorOf, live, arrows } = args;

  useEffect(() => {
    handleRef.current?.setPlayhead(playhead);
  }, [handleRef, playhead, state]);

  useEffect(() => {
    handleRef.current?.recolor(colorOf);
  }, [handleRef, colorOf, state]);

  useEffect(() => {
    handleRef.current?.setDirectionArrows(arrows);
  }, [handleRef, arrows, state]);

  // Depends on the coordinates, not the object identity: status reports
  // arrive continuously and a fresh object each poll would re-render the
  // scene even when the machine has not moved.
  useEffect(() => {
    handleRef.current?.setLiveMachine(live);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [handleRef, state, live?.x, live?.y, live?.z, live === null]);
}
