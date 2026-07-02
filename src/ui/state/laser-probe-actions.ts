// laser-probe-actions — store-facing probe action (ADR-102 G2). Sibling to
// laser-jog-actions.ts; guards the shared machine against overlapping
// operations, then delegates to the pure protocol runner.

import type { SerialConnection } from '../../platform/types';
import { runProbeSequence, type ProbeResult } from './probe-actions';
import {
  activeJobCommandBlockMessage,
  motionOperationCommandBlockMessage,
} from './laser-store-helpers';
import type { LaserState } from './laser-store';

type SetFn = (partial: Partial<LaserState>) => void;
type GetFn = () => LaserState;
type ProbeRefs = { readonly connection: SerialConnection | null };

export function probeActions(set: SetFn, get: GetFn, refs: ProbeRefs): Pick<LaserState, 'probe'> {
  return {
    probe: async (lines): Promise<ProbeResult> => {
      const activeJobBlock = activeJobCommandBlockMessage(get());
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
        return await runProbeSequence({
          connection: refs.connection,
          statusReport: get().statusReport,
          lines,
        });
      } finally {
        set({ probeBusy: false });
      }
    },
  };
}
