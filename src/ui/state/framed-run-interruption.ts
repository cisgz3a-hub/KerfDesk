import type { StatusReport } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';

export function framedRunInterruptionPatch(
  state: LaserState,
  report: StatusReport,
  startOwnsSettleDwell = false,
): Partial<Pick<LaserState, 'framedRun' | 'frameVerification' | 'controllerOperation'>> {
  if (state.framedRun === null || report.state === 'Idle') {
    return {};
  }
  if (
    startOwnsSettleDwell &&
    report.state === 'Run' &&
    report.subState === null &&
    state.controllerOperation?.kind === 'start-arming' &&
    state.controllerOperation.phase === 'queue-fence'
  ) {
    return {
      controllerOperation: {
        ...state.controllerOperation,
        ownedRunStatusSequence: state.statusSequence + 1,
        ownedRunPermit: state.framedRun,
      },
    };
  }
  // A permit is a one-way authorization. Any controller-owned motion/hold/
  // mode transition after completion consumes the physical proof even when a
  // later Idle happens to report the same coordinates.
  return { framedRun: null, frameVerification: null };
}

/** A stamped CNC dwell Run remains exempt only for the exact report sequence
 * and permit identity accepted at line ingress. Position/setup equality is
 * still checked by the permit invalidation subscription. */
export function isStampedStartRun(state: LaserState, report: StatusReport | null): boolean {
  return (
    report?.state === 'Run' &&
    state.controllerOperation?.kind === 'start-arming' &&
    state.controllerOperation.ownedRunStatusSequence === state.statusSequence &&
    state.controllerOperation.ownedRunPermit === state.framedRun
  );
}
