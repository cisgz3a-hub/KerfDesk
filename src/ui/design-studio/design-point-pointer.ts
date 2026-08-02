import type { Vec2 } from '../../core/scene';
import {
  advanceArcSequence,
  advancePathSequence,
  arcSnapMatchesRadius,
  beginArcSequence,
  beginPathSequence,
  constrainArcTarget,
  constrainPathTarget,
  finishOpenPath,
  POINT_SEQUENCE_CLOSE_RADIUS_PX,
  updateArcSequence,
  updatePointSequence,
} from './design-point-sequence';
import type { DesignSession } from './design-session';
import { snapToGridMm, type ResolvedSnap } from './design-snap';
import { useDesignStudioStore } from './design-studio-store';

export function handlePointToolClick(
  atMm: Vec2,
  session: DesignSession,
  pxPerMm: number,
  newEntityId: () => string,
): void {
  if (session.tool === 'path') handlePathClick(atMm, session, pxPerMm, newEntityId);
  if (session.tool === 'arc') handleArcClick(atMm, session, newEntityId);
}

export function updatePointToolPointer(atMm: Vec2, session: DesignSession, pxPerMm: number): void {
  const sequence = session.pointSequence;
  if (sequence === null) return;
  const hasObjectSnap = session.activeSnap !== null;
  const targetMm =
    sequence.kind === 'path'
      ? constrainPathTarget(sequence, atMm, {
          orthoEnabled: session.orthoEnabled,
          hasObjectSnap,
          closeToleranceMm: POINT_SEQUENCE_CLOSE_RADIUS_PX / positiveScale(pxPerMm),
        })
      : constrainArcTarget(sequence, atMm, {
          orthoEnabled: session.orthoEnabled,
          hasObjectSnap,
        });
  const next =
    sequence.kind === 'path'
      ? updatePointSequence(sequence, targetMm)
      : updateArcSequence(sequence, targetMm);
  const store = useDesignStudioStore.getState();
  store.setCursorMm(targetMm);
  store.setPointSequence(next);
}

export function finishPointToolDoubleClick(newEntityId: () => string): boolean {
  const store = useDesignStudioStore.getState();
  const session = store.session;
  if (session === null || (session.tool !== 'path' && session.tool !== 'arc')) return false;
  if (!finishDoubleClickSequence(session, newEntityId)) return false;
  store.setSelection([]);
  store.setTool('select');
  return true;
}

function finishDoubleClickSequence(session: DesignSession, newEntityId: () => string): boolean {
  const sequence = session.pointSequence;
  if (sequence === null) return true;
  const store = useDesignStudioStore.getState();
  if (sequence.kind === 'path') {
    if (session.tool !== 'path') return false;
    const entity = finishOpenPath(sequence, newEntityId(), { discardLastClick: true });
    if (entity === null) store.setPointSequence(null);
    else store.commitPointEntity(entity);
    return true;
  }
  if (session.tool !== 'arc') return false;
  store.setPointSequence(null);
  return true;
}

export function truthfulPointToolSnap(
  session: DesignSession,
  resolved: ResolvedSnap,
  rawMm: Vec2,
): ResolvedSnap {
  const sequence = session.pointSequence;
  if (
    sequence?.kind !== 'arc' ||
    sequence.startMm === null ||
    resolved.target === null ||
    arcSnapMatchesRadius(sequence, resolved.target.atMm)
  ) {
    return resolved;
  }
  return {
    pointMm: snapToGridMm(rawMm, {
      enabled: session.snapEnabled,
      gridMm: session.gridMm,
    }),
    target: null,
  };
}

function handlePathClick(
  atMm: Vec2,
  session: DesignSession,
  pxPerMm: number,
  newEntityId: () => string,
): void {
  const store = useDesignStudioStore.getState();
  const sequence = session.pointSequence;
  if (sequence?.kind !== 'path') {
    store.setPointSequence(beginPathSequence(atMm));
    return;
  }
  const toleranceMm = POINT_SEQUENCE_CLOSE_RADIUS_PX / positiveScale(pxPerMm);
  const targetMm = constrainPathTarget(sequence, atMm, {
    orthoEnabled: session.orthoEnabled,
    hasObjectSnap: session.activeSnap !== null,
    closeToleranceMm: toleranceMm,
  });
  const advanced = advancePathSequence(sequence, targetMm, {
    closeToleranceMm: toleranceMm,
    hasObjectSnap: session.activeSnap !== null,
  });
  if (advanced.kind === 'continue') {
    store.setPointSequence(advanced.sequence);
    return;
  }
  store.commitPointEntity({
    kind: 'path',
    id: newEntityId(),
    points: advanced.points,
    closed: true,
  });
}

function handleArcClick(atMm: Vec2, session: DesignSession, newEntityId: () => string): void {
  const store = useDesignStudioStore.getState();
  const sequence = session.pointSequence;
  if (sequence?.kind !== 'arc') {
    store.setPointSequence(beginArcSequence(atMm));
    return;
  }
  const targetMm = constrainArcTarget(sequence, atMm, {
    orthoEnabled: session.orthoEnabled,
    hasObjectSnap: session.activeSnap !== null,
  });
  const advanced = advanceArcSequence(sequence, targetMm);
  if (advanced.kind === 'continue') {
    store.setPointSequence(advanced.sequence);
    return;
  }
  store.commitPointEntity({ ...advanced.geometry, id: newEntityId() });
}

function positiveScale(pxPerMm: number): number {
  return pxPerMm > 0 ? pxPerMm : 1;
}
