// design-session-mutations — the pure session transitions behind the store actions
// (ADR-272). Split out of design-studio-store.ts when that file crossed the 250-line
// soft cap: the store is zustand wiring, and these are the sketch-and-selection
// transitions it wires up. Every function here is total — it returns the session
// unchanged rather than throwing when an operation cannot apply (rule 7).

import { addEntity, replaceEntity, type SketchEntity } from '../../core/design';
import { translateEntities } from '../../core/design/ops';
import type { Vec2 } from '../../core/scene';
import { applyCornerOp, type CornerOp } from './design-corner-apply';
import type { CornerPick } from './design-corner-pick';
import { draftToEntity } from './design-draft';
import { applyEntityField } from './design-entity-edit';
import type { MeasurementKey } from './design-entity-fields';
import { commitSketch, replacePresent } from './design-history';
import { entitiesInRectMm } from './design-hit-test';
import { sessionSketch, withSketch, type DesignSession } from './design-session';

// The draft becomes an entity, the entity becomes one history step, and the new
// entity becomes the selection — so the operator can immediately edit what they
// just drew. A degenerate draft simply clears (a click is not a draw). The new
// entity lands on the active carve layer (ADR-272 Amendment 1).
export function commitSessionDraft(session: DesignSession, id: string): DesignSession {
  if (session.draft === null) return session;
  const drafted = draftToEntity(session.draft, id);
  const entity = drafted === null ? null : { ...drafted, layerId: session.activeLayerId };
  const cleared: DesignSession = { ...session, draft: null };
  if (entity === null) return cleared;
  const next = addEntity(sessionSketch(session), entity);
  if (next === sessionSketch(session)) return cleared;
  return { ...withSketch(cleared, next), selectedIds: new Set([entity.id]) };
}

// The copy lands offset so it is visibly a second shape rather than hiding
// exactly on top of the original, and becomes the selection so it can be moved.
export function duplicateSessionEntity(
  session: DesignSession,
  id: string,
  newId: string,
  offsetMm: number,
): DesignSession {
  const sketch = sessionSketch(session);
  const source = sketch.entities.find((candidate) => candidate.id === id);
  if (source === undefined) return session;
  const moved = translateEntity(source, newId, offsetMm);
  const next = addEntity(sketch, moved);
  if (next === sketch) return session;
  return { ...withSketch(session, next), selectedIds: new Set([newId]) };
}

export function translateEntity(
  entity: SketchEntity,
  newId: string,
  deltaMm: number,
): SketchEntity {
  const shift = (point: { readonly x: number; readonly y: number }) => ({
    x: point.x + deltaMm,
    y: point.y + deltaMm,
  });
  switch (entity.kind) {
    case 'rect':
      return { ...entity, id: newId, origin: shift(entity.origin) };
    case 'circle':
    case 'ellipse':
    case 'arc':
      return { ...entity, id: newId, center: shift(entity.center) };
    case 'line':
      return { ...entity, id: newId, start: shift(entity.start), end: shift(entity.end) };
    case 'path':
      return { ...entity, id: newId, points: entity.points.map(shift) };
  }
}

export function setSessionConstruction(
  session: DesignSession,
  id: string,
  construction: boolean,
): DesignSession {
  const sketch = sessionSketch(session);
  const entity = sketch.entities.find((candidate) => candidate.id === id);
  if (entity === undefined) return session;
  return withSketch(session, replaceEntity(sketch, { ...entity, construction }));
}

// Uses the size the tool is currently set to, so the click carries no size of its
// own. A corner that cannot take that size leaves the sketch untouched.
export function applyCornerToSession(
  session: DesignSession,
  pick: CornerPick,
  op: CornerOp,
): DesignSession {
  const sizeMm = op === 'fillet' ? session.filletRadiusMm : session.chamferDistanceMm;
  const next = applyCornerOp(sessionSketch(session), pick, op, sizeMm);
  return next === null ? session : withSketch(session, next);
}

export function beginSessionMove(session: DesignSession, atMm: Vec2): DesignSession {
  if (session.selectedIds.size === 0) return session;
  return {
    ...session,
    move: { lastMm: atMm, beforeSketch: sessionSketch(session), ids: session.selectedIds },
  };
}

// Applies the incremental delta straight to the present WITHOUT recording a step,
// so a long drag stays one undo entry instead of hundreds.
export function updateSessionMove(session: DesignSession, atMm: Vec2): DesignSession {
  const move = session.move;
  if (move === null) return session;
  const delta = { x: atMm.x - move.lastMm.x, y: atMm.y - move.lastMm.y };
  const moved = translateEntities(sessionSketch(session), move.ids, delta);
  if (moved === sessionSketch(session)) return { ...session, move: { ...move, lastMm: atMm } };
  return {
    ...session,
    history: replacePresent(session.history, moved),
    move: { ...move, lastMm: atMm },
    dirtySinceApply: true,
  };
}

// Records the whole gesture as one step, undoing back to where it started. A drag
// that ended where it began leaves no step at all.
export function endSessionMove(session: DesignSession): DesignSession {
  const move = session.move;
  if (move === null) return session;
  const cleared: DesignSession = { ...session, move: null };
  const current = sessionSketch(session);
  if (current === move.beforeSketch) return cleared;
  return {
    ...cleared,
    history: commitSketch(replacePresent(session.history, move.beforeSketch), current),
    dirtySinceApply: true,
  };
}

// One typed value becomes one history step, so Ctrl+Z steps back through edits
// the same way it steps back through drawn shapes.
export function editSessionField(
  session: DesignSession,
  id: string,
  key: MeasurementKey,
  value: number,
): DesignSession {
  const sketch = sessionSketch(session);
  const entity = sketch.entities.find((candidate) => candidate.id === id);
  if (entity === undefined) return session;
  const edited = applyEntityField(entity, key, value);
  if (edited === null) return session;
  return withSketch(session, replaceEntity(sketch, edited));
}

export function commitSessionMarquee(session: DesignSession, additive: boolean): DesignSession {
  if (session.marquee === null) return session;
  const enclosed = entitiesInRectMm(
    sessionSketch(session),
    session.marquee.anchorMm,
    session.marquee.pointerMm,
  ).map((entity) => entity.id);
  const selectedIds = additive ? new Set([...session.selectedIds, ...enclosed]) : new Set(enclosed);
  return { ...session, marquee: null, selectedIds };
}

export function nudgeSession(session: DesignSession, deltaMm: Vec2): DesignSession {
  return withSketch(
    session,
    translateEntities(sessionSketch(session), session.selectedIds, deltaMm),
  );
}
