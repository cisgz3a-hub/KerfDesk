import type { CncContourPass, CncPass, CncGroup, Job } from '../job';
import { cncContourEmissionVertices } from '../cnc/cnc-contour-emission';
import { flatPath3dZMm, type CncRecoveryEvent } from './cnc-recovery-manifest';

export type ResolvedContourSource =
  | {
      readonly kind: 'ok';
      readonly group: CncGroup;
      readonly pass: CncContourPass;
      /** Segment index in the represented pass used for preview and replay. */
      readonly segmentIndex: number;
      /** Segment index in the sealed raw pass and manifest identity. */
      readonly sourceSegmentIndex: number;
      /** Raw manifest event that produced the preceding represented vertex. */
      readonly previousEventId: string | null;
    }
  | {
      readonly kind: 'error';
      readonly reason: 'source-mismatch' | 'unsupported-pass' | 'invalid-geometry';
    };

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
  if (!contour.polyline.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
    return { kind: 'error', reason: 'invalid-geometry' };
  }
  return pass.kind === 'contour'
    ? resolveRepresentedContour(group, pass, event, segmentIndex)
    : resolvedFlatPath(group, contour, event, segmentIndex);
}

function resolvedFlatPath(
  group: CncGroup,
  pass: CncContourPass,
  event: CncRecoveryEvent,
  segmentIndex: number,
): ResolvedContourSource {
  return {
    kind: 'ok',
    group,
    pass,
    segmentIndex,
    sourceSegmentIndex: segmentIndex,
    previousEventId: segmentIndex === 0 ? null : `${event.passId}/cut-${segmentIndex}`,
  };
}

function resolveRepresentedContour(
  group: CncGroup,
  pass: CncContourPass,
  event: CncRecoveryEvent,
  sourceSegmentIndex: number,
): ResolvedContourSource {
  const vertices = cncContourEmissionVertices(pass);
  const representedTargetIndex = vertices.findIndex(
    (vertex) => vertex.sourcePointIndex === sourceSegmentIndex + 1,
  );
  if (representedTargetIndex <= 0) return { kind: 'error', reason: 'source-mismatch' };
  const representedSegmentIndex = representedTargetIndex - 1;
  const representedStart = vertices[representedSegmentIndex];
  if (representedStart === undefined) return { kind: 'error', reason: 'source-mismatch' };
  return {
    kind: 'ok',
    group,
    pass: { ...pass, polyline: vertices.map((vertex) => vertex.point) },
    segmentIndex: representedSegmentIndex,
    sourceSegmentIndex,
    previousEventId:
      representedSegmentIndex === 0
        ? null
        : `${event.passId}/cut-${representedStart.sourcePointIndex}`,
  };
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
