import type { CncContourPass, CncGroup, Job } from '../job';
import type { CncRecoveryEvent } from './cnc-recovery-manifest';

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
  if (pass.kind !== 'contour') return { kind: 'error', reason: 'unsupported-pass' };
  if (segmentIndex < 0 || segmentIndex >= pass.polyline.length - 1) {
    return { kind: 'error', reason: 'source-mismatch' };
  }
  return { kind: 'ok', group, pass, segmentIndex };
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
