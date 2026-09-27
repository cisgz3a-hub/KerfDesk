// Apply the initial view while hidden so GPU preparation covers it. Publishing
// ready must not submit an identical, unfenced frame to the visible canvas.

import { useEffect, useRef, type RefObject } from 'react';
import type { ArrowPlacement, PlayheadMarker, Viewer3dSceneHandle } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dClipPlane } from '../viewer3d/scene-isolate';
import type { Viewer3dStage } from '../viewer3d/viewer3d-look';
import type { Viewer3dSceneState } from './use-viewer3d-scene';

type SceneSyncArgs = {
  readonly handleRef: RefObject<Viewer3dSceneHandle | null>;
  readonly state: Viewer3dSceneState;
  readonly model?: unknown;
  readonly hidePlaybackMarker?: boolean;
  /** Null reveals the whole program and hides the tool marker. */
  readonly playhead: PlayheadMarker | null;
  readonly colorOf: (segmentIndex: number) => readonly [number, number, number];
  /** Live machine position from controller status; null hides the marker. */
  readonly live: { readonly x: number; readonly y: number; readonly z: number } | null;
  /** Direction arrowheads, or null when the overlay is off. */
  readonly arrows: ReadonlyArray<ArrowPlacement> | null;
  readonly travelVisible: boolean;
  /** Classic or Studio, and what Studio dresses the job with (ADR-426). */
  readonly stage?: Viewer3dStage;
  /** Legend filters and the Z range and section planes (ADR-470). */
  readonly moveFilter?: Uint8Array | null;
  readonly clipPlanes?: ReadonlyArray<Viewer3dClipPlane>;
};

const NO_PLANES: ReadonlyArray<Viewer3dClipPlane> = [];

type AppliedSceneSync = SceneSyncArgs & { readonly handle: Viewer3dSceneHandle };

export function useSceneSync(args: SceneSyncArgs): void {
  const applied = useRef<AppliedSceneSync | null>(null);
  // Observe each commit, but only mutate fields whose values changed. A new
  // status object with the same coordinates must not schedule another frame.
  useEffect(() => {
    const { state, model } = args;
    const handle = args.handleRef.current;
    if (handle === null || (state !== 'preparing' && state !== 'ready')) {
      applied.current = null;
      return;
    }
    const previous = applied.current;
    if (shouldDeferSync(previous, handle, args)) return;
    const force =
      previous === null ||
      previous.handle !== handle ||
      previous.model !== model ||
      (state === 'preparing' && previous.state !== 'preparing');
    syncSceneValues(handle, args, previous, force);
    applied.current = { ...args, handle };
  });
}

function shouldDeferSync(
  previous: AppliedSceneSync | null,
  handle: Viewer3dSceneHandle,
  next: SceneSyncArgs,
): boolean {
  if (previous === null || previous.handle !== handle) return false;
  // A replacement first commits preparing, then swaps geometry. Never apply
  // its lens to the old geometry. Continuous live changes also must not
  // restart the same model's fence; ready applies their latest values.
  return (
    (next.state === 'ready' && previous.model !== next.model) ||
    (next.state === 'preparing' && previous.state === 'preparing' && previous.model === next.model)
  );
}

function syncSceneValues(
  handle: Viewer3dSceneHandle,
  next: SceneSyncArgs,
  previous: AppliedSceneSync | null,
  force: boolean,
): void {
  if (force || previous === null) {
    if (next.stage !== undefined) handle.setStage(next.stage);
    handle.setTravelVisible(next.travelVisible);
    handle.setMoveFilter(next.moveFilter ?? null);
    handle.setClipPlanes(next.clipPlanes ?? NO_PLANES);
    setScenePlayhead(handle, next);
    handle.recolor(next.colorOf);
    handle.setDirectionArrows(next.arrows);
    handle.setLiveMachine(next.live);
    return;
  }
  syncDrawnMoves(handle, next, previous);
  if (
    !samePlayhead(previous.playhead, next.playhead) ||
    Boolean(previous.hidePlaybackMarker) !== Boolean(next.hidePlaybackMarker)
  ) {
    setScenePlayhead(handle, next);
  }
  if (previous.colorOf !== next.colorOf) handle.recolor(next.colorOf);
  if (previous.arrows !== next.arrows) handle.setDirectionArrows(next.arrows);
  if (!samePoint(previous.live, next.live)) handle.setLiveMachine(next.live);
}

// Which moves are drawn: the look, traversal, legend filters and clipping.
function syncDrawnMoves(
  handle: Viewer3dSceneHandle,
  next: SceneSyncArgs,
  previous: AppliedSceneSync,
): void {
  if (next.stage !== undefined && previous.stage !== next.stage) handle.setStage(next.stage);
  if (previous.travelVisible !== next.travelVisible) handle.setTravelVisible(next.travelVisible);
  if (previous.moveFilter !== next.moveFilter) handle.setMoveFilter(next.moveFilter ?? null);
  if (previous.clipPlanes !== next.clipPlanes) handle.setClipPlanes(next.clipPlanes ?? NO_PLANES);
}

function setScenePlayhead(handle: Viewer3dSceneHandle, next: SceneSyncArgs): void {
  handle.setPlayhead(
    next.playhead === null
      ? null
      : { ...next.playhead, hideMarker: next.hidePlaybackMarker === true },
  );
}

function samePlayhead(left: PlayheadMarker | null, right: PlayheadMarker | null): boolean {
  if (left === null || right === null) return left === right;
  return left.segmentIndex === right.segmentIndex && samePoint(left.point, right.point);
}

function samePoint(left: SceneSyncArgs['live'], right: SceneSyncArgs['live']): boolean {
  return left?.x === right?.x && left?.y === right?.y && left?.z === right?.z;
}
