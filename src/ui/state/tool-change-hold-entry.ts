// tool-change-hold-entry — the one place a stepped job streamer is installed
// in the laser store, so every way into a CNC tool-change hold applies the
// same entry patch (ADR-171).
//
// A hold can be reached from four sites: an ack-driven refill
// (advanceStream), Start's first window, a Continue fill that runs into the
// next M0, and the Resume refill. Each used to carry its own copy of the entry
// patch and the Resume refill carried none, so a hold it reached kept the
// previous bit's Z0, a stale fresh-Idle latch and the previous hold's bit name.
// Continue then unlocked for the wrong bit (controller audit streaming-1).
// Routing every site through `steppedStreamerPatch` keeps them from drifting.

import type { StreamerState } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';

type ToolQueueState = Pick<
  LaserState,
  'workZReferenceEpoch' | 'toolChangeLabels' | 'toolChangeToolIds'
>;

export type ToolChangeHoldEntryPatch = Pick<
  LaserState,
  | 'workZZeroEvidence'
  | 'workZReferenceEpoch'
  | 'toolChangeIdleSeen'
  | 'pendingToolLabel'
  | 'pendingToolId'
  | 'toolChangeLabels'
  | 'toolChangeToolIds'
>;

// A new bit is going in: void the prior tool's Z0 and bump the epoch, require
// a FRESH Idle before the setup gate / Continue unlock, and advance the
// pending-tool label + id to name the incoming bit.
export function toolChangeHoldEntryPatch(state: ToolQueueState): ToolChangeHoldEntryPatch {
  return {
    workZZeroEvidence: null,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    toolChangeIdleSeen: false,
    pendingToolLabel: state.toolChangeLabels[0] ?? null,
    pendingToolId: state.toolChangeToolIds[0] ?? null,
    toolChangeLabels: state.toolChangeLabels.slice(1),
    toolChangeToolIds: state.toolChangeToolIds.slice(1),
  };
}

/**
 * Installs `stepped` as the store's streamer. `input` is the streamer that was
 * handed to `step()` (null for a stream Start is creating). When that step
 * carried a running stream into 'tool-change', the hold-entry patch applies in
 * the same store update, so no reader ever sees a hold that still carries the
 * previous bit's Z0 or name. A step from a stream that was already holding
 * returns it unchanged and is not a new hold.
 */
export function steppedStreamerPatch(
  state: ToolQueueState,
  input: Pick<StreamerState, 'status'> | null,
  stepped: StreamerState,
): Pick<LaserState, 'streamer'> & Partial<ToolChangeHoldEntryPatch> {
  const entersHold = stepped.status === 'tool-change' && input?.status !== 'tool-change';
  return entersHold
    ? { streamer: stepped, ...toolChangeHoldEntryPatch(state) }
    : { streamer: stepped };
}
