// laser-probe-actions — store-facing probe action (ADR-103 G2). Sibling to
// laser-jog-actions.ts; guards the shared machine against overlapping
// operations, then delegates to the pure protocol runner.

import type { SerialConnection } from '../../platform/types';
import { runProbeSequence, type ProbeResult } from './probe-actions';
import {
  motionOperationCommandBlockMessage,
  setupBlockingJobCommandBlockMessage,
} from './laser-store-helpers';
import type { LaserState } from './laser-store';

type SetFn = (partial: Partial<LaserState>) => void;
type GetFn = () => LaserState;
type ProbeRefs = { readonly connection: SerialConnection | null };

export function probeActions(set: SetFn, get: GetFn, refs: ProbeRefs): Pick<LaserState, 'probe'> {
  return {
    probe: async (lines): Promise<ProbeResult> => {
      const activeJobBlock = setupBlockingJobCommandBlockMessage(get());
      if (activeJobBlock !== null) return { kind: 'preflight-failed', reason: activeJobBlock };
      const motionBlock = motionOperationCommandBlockMessage(get());
      if (motionBlock !== null) return { kind: 'preflight-failed', reason: motionBlock };
      if (get().autofocusBusy) {
        return { kind: 'preflight-failed', reason: 'Auto-focus is running.' };
      }
      if (get().probeBusy) {
        return { kind: 'preflight-failed', reason: 'A probe cycle is already running.' };
      }
      set({ probeBusy: true });
      try {
        const result = await runProbeSequence({
          connection: refs.connection,
          statusReport: get().statusReport,
          lines,
        });
        // A successful touch-plate probe runs the caller's probe lines, which set
        // work Z0 — establish the CNC stock-top contract for the Start advisory.
        if (result.kind === 'ok') set({ workZZeroKnown: true });
        return result;
      } finally {
        set({ probeBusy: false });
      }
    },
  };
}
