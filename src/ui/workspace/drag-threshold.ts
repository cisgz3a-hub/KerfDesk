// A press becomes a drag only once it has travelled (ADR-196 Amendment 1).
//
// Move, scale and rotate used to start on the press itself, so a click that
// slipped one pixel moved the artwork, and with snapping on that pixel was
// pulled to the nearest grid line: a click to select left the object somewhere
// else, the project changed and a Move in undo (annoyance audit A2, B6-P2-3).
//
// The travel is measured on the screen, from where the button went down. Until
// it is passed nothing is written and no undo snapshot is taken; after it the
// drag is the same drag as before, still measured from the press point, so
// what was grabbed stays under the pointer.

import type { MutableRefObject } from 'react';
import type { DragState } from './drag-state';

// Travel in CSS pixels. A mouse matches the right-click's own tolerance
// (pan-drag.ts); a pen tip skates and a fingertip rolls as they land, so they
// are given more.
const DRAG_START_TRAVEL_PX = { mouse: 4, pen: 6, touch: 10 } as const;

export type PressTravel = {
  readonly startClientX: number;
  readonly startClientY: number;
  readonly thresholdPx: number;
  /** Set once, when the pointer first passes the threshold. */
  travelled: boolean;
};

export type PressRef = MutableRefObject<PressTravel | null>;

/** How a press ended, for the release handler. */
export type PressRelease = {
  /** The pointer passed the threshold at some point: the press was a drag. */
  readonly travelled: boolean;
  /** It never did, and was released where it went down: a click. */
  readonly click: boolean;
};

/** A release with no press on record counts as a finished drag. */
export const DRAGGED_RELEASE: PressRelease = { travelled: true, click: false };

type PressEvent = {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerType?: string;
};

type WaitingDrag = Extract<DragState, { kind: 'move' | 'scale' | 'selection-scale' | 'rotate' }>;

export function dragStartTravelPx(pointerType: string | undefined): number {
  if (pointerType === 'touch') return DRAG_START_TRAVEL_PX.touch;
  if (pointerType === 'pen') return DRAG_START_TRAVEL_PX.pen;
  return DRAG_START_TRAVEL_PX.mouse;
}

export function pressTravelFor(event: PressEvent): PressTravel {
  return {
    startClientX: event.clientX,
    startClientY: event.clientY,
    thresholdPx: dragStartTravelPx(event.pointerType),
    travelled: false,
  };
}

/** The drags that write transforms, and so wait for the press to travel. */
export function dragWaitsForTravel(drag: DragState): drag is WaitingDrag {
  return (
    drag.kind === 'move' ||
    drag.kind === 'scale' ||
    drag.kind === 'selection-scale' ||
    drag.kind === 'rotate'
  );
}

// A trace-part pick separates its geometry on the press and snapshots before
// that (trace-part-tool.ts): its move waits like any other, on that snapshot.
function snapshotTakenAtPress(drag: WaitingDrag): boolean {
  return drag.kind === 'move' && drag.interactionStarted === true;
}

function withinThreshold(press: PressTravel, event: PressEvent): boolean {
  const dx = event.clientX - press.startClientX;
  const dy = event.clientY - press.startClientY;
  return Math.hypot(dx, dy) <= press.thresholdPx;
}

/**
 * Whether this pointer move reaches the drag. A waiting drag swallows moves
 * inside the threshold; the move that passes it takes the undo snapshot and
 * every later one goes through, wherever the pointer is.
 */
export function pressAllowsMove(
  press: PressTravel | null,
  drag: DragState | null,
  event: PressEvent,
  beginInteraction: () => void,
): boolean {
  if (press === null || drag === null || press.travelled) return true;
  if (withinThreshold(press, event)) return !dragWaitsForTravel(drag);
  press.travelled = true;
  if (dragWaitsForTravel(drag) && !snapshotTakenAtPress(drag)) beginInteraction();
  return true;
}

export function pressReleaseFor(press: PressTravel | null, event: PressEvent): PressRelease {
  if (press === null) return DRAGGED_RELEASE;
  return {
    travelled: press.travelled,
    click: !press.travelled && withinThreshold(press, event),
  };
}

/**
 * Ends a waiting drag whose press never travelled. Nothing was written and no
 * snapshot taken, so there is no interaction to end. A click on one of several
 * selected objects narrows the selection to it (B6-P3-9). False: the drag did
 * begin, or holds a snapshot of its own, and ends the usual way.
 */
export function finishPressWithoutTravel(
  drag: DragState,
  release: PressRelease,
  selectObject: (id: string) => void,
): boolean {
  if (release.travelled || !dragWaitsForTravel(drag) || snapshotTakenAtPress(drag)) return false;
  if (release.click && drag.kind === 'move' && drag.clickSelectsId !== undefined) {
    selectObject(drag.clickSelectsId);
  }
  return true;
}
