import type { CncContourPass, CncPass, CncGroup, Job } from '../job';
import { flatPath3dZMm, type CncRecoveryEvent } from './cnc-recovery-manifest';

export type ResolvedContourSource =
  | {
      readonly kind: 'ok';
      readonly group: CncGroup;
      readonly pass: CncContourPass;
      readonly segmentIndex: number;
    }
  | { readonly kind: 'error'; readonly reason: 'source-mismatch' | 'unsupported-pass' };

export function resolveContourSource(job: Job, event: CncRecoveryEvent): ResolvedContourSource {
  const segmentIndex = event.source.segmentIndex;
  if (segmentIndex === null) return { kind: 'error', reason: 'source-mismatch' };
  const group = job.groups[event.source.groupIndex];
  if (group?.kind !== 'cnc') return { kind: 'error', reason: 'source-mismatch' };
  const pass = group.passes[event.source.passIndex];
  if (pass === undefined || pass.kind !== event.source.passKind) {
    return { kind: 'error', reason: 'source-mismatch' };
  }
  const contour = contourViewOf(pass);
  if (contour === null) return { kind: 'error', reason: 'unsupported-pass' };
  if (segmentIndex < 0 || segmentIndex >= contour.polyline.length - 1) {
    return { kind: 'error', reason: 'source-mismatch' };
  }
  return { kind: 'ok', group, pass: contour, segmentIndex };
}

// A plain contour is used directly; a FLAT led path3d (ADR-250) is presented as
// a contour at its single cut depth so the shared runway geometry applies. Ramp,
// relief, arc, and helical passes are unsupported for runway recovery.
function contourViewOf(pass: CncPass): CncContourPass | null {
  if (pass.kind === 'contour') return pass;
  const zMm = flatPath3dZMm(pass);
  if (pass.kind !== 'path3d' || zMm === null) return null;
  return {
    kind: 'contour',
    zMm,
    polyline: pass.points.map((point) => ({ x: point.x, y: point.y })),
    closed: pass.closed,
  };
}

export function recoveryEventsEqual(left: CncRecoveryEvent, right: CncRecoveryEvent): boolean {
  return (
    left.id === right.id &&
    left.operationId === right.operationId &&
    left.passId === right.passId &&
    left.intent === right.intent &&
    left.recoverySupport === right.recoverySupport &&
    left.toolKey === right.toolKey &&
    left.source.groupIndex === right.source.groupIndex &&
    left.source.passIndex === right.source.passIndex &&
    left.source.segmentIndex === right.source.segmentIndex &&
    left.source.passKind === right.source.passKind
  );
}
