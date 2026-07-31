// use-design-pointer — the canvas gesture state machine (ADR-272, DS-3).
//
// Tools are STATES, not flags (tldraw's published model): the armed tool decides
// what a pointer event means, so there is no growing pile of booleans and no
// single dispatch function creeping toward the complexity cap — which is exactly
// what happened to the main workspace's beginToolDrag (11 of 12 today).
//
// Idle → Pointing → Dragging, one handler per phase. A gesture that never moves
// far enough is a click, not a draw, and commits nothing.

import { useCallback } from 'react';
import type { Vec2 } from '../../core/scene';
import { isDraftTool, NO_MODIFIERS, type DraftModifiers } from './design-draft';
import { CORNER_PICK_RADIUS_PX, pickCorner } from './design-corner-pick';
import { hitTestSketch, HIT_RADIUS_PX } from './design-hit-test';
import { useDesignStudioStore } from './design-studio-store';
import { applyOrthoMm, snapPointMm } from './design-snap';
import type { DesignSurface } from './design-surface';

export type DesignPointerHandlers = {
  readonly onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerLeave: () => void;
};

export function useDesignPointer(
  surface: DesignSurface,
  newEntityId: () => string,
): DesignPointerHandlers {
  const pointMm = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): Vec2 | null =>
      resolvePointerMm(surface, event),
    [surface],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const at = pointMm(event);
      const store = useDesignStudioStore.getState();
      const session = store.session;
      if (at === null || session === null) return;
      capturePointer(event.currentTarget, event.pointerId);
      if (isDraftTool(session.tool)) {
        store.setDraft({
          tool: session.tool,
          anchorMm: at,
          pointerMm: at,
          modifiers: modifiersOf(event),
        });
        return;
      }
      const pxPerMm = surface.pxPerMm();
      if (session.tool === 'fillet' || session.tool === 'chamfer') {
        applyCornerAt(at, session.tool, pxPerMm);
        return;
      }
      if (session.tool === 'select') beginSelectOrMove(at, event, pxPerMm);
    },
    [pointMm, surface],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const at = pointMm(event);
      const store = useDesignStudioStore.getState();
      const session = store.session;
      if (at === null || session === null) return;
      store.setCursorMm(at);
      if (session.move !== null) {
        store.updateMove(at);
        return;
      }
      if (session.draft !== null) {
        const constrained = applyOrthoMm(session.draft.anchorMm, at, session.orthoEnabled);
        store.setDraft({ ...session.draft, pointerMm: constrained, modifiers: modifiersOf(event) });
        return;
      }
      if (session.marquee !== null) store.setMarquee({ ...session.marquee, pointerMm: at });
    },
    [pointMm],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const store = useDesignStudioStore.getState();
      const session = store.session;
      if (session === null) return;
      releasePointer(event.currentTarget, event.pointerId);
      if (session.move !== null) {
        store.endMove();
        return;
      }
      if (session.draft !== null) {
        store.commitDraft(newEntityId());
        return;
      }
      if (session.marquee !== null) store.commitMarquee(event.shiftKey);
    },
    [newEntityId],
  );

  const onPointerLeave = useCallback(() => {
    const store = useDesignStudioStore.getState();
    store.setCursorMm(null);
    store.setActiveSnap(null);
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerLeave };
}

// Resolves the pointer to a millimetre point, applying object snap first and the
// grid only as a fallback, and publishes which target captured it so the canvas can
// mark it and the status bar can name it. The surface owns the raw mapping —
// pan/zoom transform on the flat canvas, plane raycast in the 3D viewport —
// and everything after the mapping is shared.
function resolvePointerMm(
  surface: DesignSurface,
  event: React.PointerEvent<HTMLCanvasElement>,
): Vec2 | null {
  const store = useDesignStudioStore.getState();
  const session = store.session;
  const raw = surface.toMm(event);
  if (session === null || raw === null) return null;
  const resolved = snapPointMm({
    sketch: session.history.present,
    rawMm: raw,
    pxPerMm: surface.pxPerMm(),
    snapEnabled: session.snapEnabled,
    gridMm: session.gridMm,
  });
  store.setActiveSnap(resolved.target);
  return resolved.pointMm;
}

// The corner tools are click-to-apply rather than drag: pick the nearest corner and
// run the op at the size the tool is set to. A click that finds no corner does
// nothing at all.
function applyCornerAt(at: Vec2, op: 'fillet' | 'chamfer', pxPerMm: number): void {
  const store = useDesignStudioStore.getState();
  const session = store.session;
  if (session === null) return;
  const toleranceMm = CORNER_PICK_RADIUS_PX / (pxPerMm > 0 ? pxPerMm : 1);
  const pick = pickCorner(session.history.present, at, toleranceMm);
  if (pick === null) return;
  store.applyCorner(pick, op);
}

// Resolve the selection first, then — if the press landed ON a shape rather than in
// empty space — start a move. Without this the Studio could select but never
// reposition, which is the most basic thing a design canvas has to do.
function beginSelectOrMove(
  at: Vec2,
  event: React.PointerEvent<HTMLCanvasElement>,
  pxPerMm: number,
): void {
  beginSelect(at, event, pxPerMm);
  const store = useDesignStudioStore.getState();
  const session = store.session;
  if (session === null || session.marquee !== null) return;
  if (session.selectedIds.size > 0) store.beginMove(at);
}

// Click an entity to select it (Shift adds); click empty space to start a
// marquee. Enclose-not-touch, matching the main workspace.
function beginSelect(
  at: Vec2,
  event: React.PointerEvent<HTMLCanvasElement>,
  pxPerMm: number,
): void {
  const store = useDesignStudioStore.getState();
  const session = store.session;
  if (session === null) return;
  const toleranceMm = HIT_RADIUS_PX / (pxPerMm > 0 ? pxPerMm : 1);
  const hit = hitTestSketch(session.history.present, at, toleranceMm);
  if (hit === null) {
    store.setMarquee({ anchorMm: at, pointerMm: at });
    if (!event.shiftKey) store.setSelection([]);
    return;
  }
  const already = session.selectedIds.has(hit.id);
  if (event.shiftKey) {
    const next = [...session.selectedIds].filter((id) => id !== hit.id);
    store.setSelection(already ? next : [...next, hit.id]);
    return;
  }
  store.setSelection([hit.id]);
}

// Pointer capture keeps the gesture alive when the pointer leaves the canvas, but
// the DOM call throws NotFoundError for a pointer id the browser does not consider
// active — which happens with synthetic events and has historically been quirky in
// Safari. A failed capture only costs edge-of-canvas tracking, so it must never
// break the gesture.
function capturePointer(target: HTMLCanvasElement, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Capture is an optimisation, not a precondition.
  }
}

function releasePointer(target: HTMLCanvasElement, pointerId: number): void {
  try {
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  } catch {
    // Already released, or never captured.
  }
}

function modifiersOf(event: React.PointerEvent<HTMLCanvasElement>): DraftModifiers {
  if (!event.shiftKey && !event.altKey) return NO_MODIFIERS;
  return { constrain: event.shiftKey, fromCentre: event.altKey };
}
