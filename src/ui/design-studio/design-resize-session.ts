// design-resize-session — the resize gesture's pure session transitions
// (ADR-272, DS-8d). Mirrors the move gesture exactly: begin captures the state
// to undo back to, update replaces the present without stacking history, and
// release commits the whole drag as ONE step.
//
// Every update scales from `beforeSketch`, never from the last frame, so the
// factor never compounds and dragging back to where you started restores the
// original geometry precisely.

import { scaleEntities } from '../../core/design/ops';
import type { Vec2 } from '../../core/scene';
import { resizeFactor, type ResizeHandle } from './design-handles';
import { commitSketch, replacePresent } from './design-history';
import { sessionSketch, type DesignSession } from './design-session';

export function beginSessionResize(session: DesignSession, handle: ResizeHandle): DesignSession {
  if (session.selectedIds.size === 0) return session;
  return {
    ...session,
    resize: { handle, beforeSketch: sessionSketch(session), ids: session.selectedIds },
  };
}

export function updateSessionResize(session: DesignSession, atMm: Vec2): DesignSession {
  const resize = session.resize;
  if (resize === null) return session;
  const factor = resizeFactor(resize.handle, atMm);
  const scaled = scaleEntities(resize.beforeSketch, resize.ids, resize.handle.anchorMm, factor);
  if (scaled === sessionSketch(session)) return session;
  return {
    ...session,
    history: replacePresent(session.history, scaled),
    dirtySinceApply: true,
  };
}

export function endSessionResize(session: DesignSession): DesignSession {
  const resize = session.resize;
  if (resize === null) return session;
  const cleared: DesignSession = { ...session, resize: null };
  const current = sessionSketch(session);
  if (current === resize.beforeSketch) return cleared;
  return {
    ...cleared,
    history: commitSketch(replacePresent(session.history, resize.beforeSketch), current),
    dirtySinceApply: true,
  };
}
