// Shared types for the line-receive pipeline modules (laser-line-handler,
// laser-status-line, laser-error-line, laser-stream-ack). Types only — the
// pipeline's behavior lives in the sibling modules.

import type { SettingsCollectorState } from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import type { ControllerQualificationScheduleRefs } from './laser-controller-qualification';
import type { ResetAlarmRefs } from './laser-reset-alarm';
import type { ResetCleanupRefs } from './laser-reset-cleanup';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import type { SerialConnection } from '../../platform/types';
import type { LaserMotionOperationId } from './laser-motion-operation';
import type { TranscriptSource } from './laser-transcript';
import type { TranscriptBufferRefs } from './laser-transcript-buffer';

export type HandlerRefs = ControllerLifecycleRefs &
  ResetCleanupRefs &
  ResetAlarmRefs & {
    // Active firmware driver — classification and follow-up command bytes come
    // from here so this pipeline stays firmware-neutral (ADR-094).
    driver: ControllerDriver;
    /** Present on the live store refs. Optional here because the narrow
     * handler harnesses omit the transport; the hosted-refill helpers treat an
     * absent connection as "this side writes refills" (ADR-334). */
    connection?: SerialConnection | null;
    settingsCollector: SettingsCollectorState;
    settingsCollectorSessionEpoch: number | null;
    // One-shot callback fired by handleLine the next time any line arrives.
    // runHandshake sets it before awaiting; handleLine clears it after
    // calling. Lets the handshake be event-driven instead of busy-polling
    // get().log.length on a 50 ms loop (R-L2 audit finding).
    onLineArrived: (() => void) | null;
    nextTranscriptId?: number;
  } & TranscriptBufferRefs &
  ControllerQualificationScheduleRefs;

export type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
export type GetFn = () => LaserState;
export type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

// Who a terminal ok/error belongs to. 'stream' routes it into the streamer's
// ack accounting; 'untracked' means a console/origin/handshake write sent
// before the stream owns it (FIFO), so the streamer must not see it.
export type AckOwner = 'stream' | 'untracked';
export type AckSettlement =
  | { readonly owner: 'stream' }
  | { readonly owner: 'untracked'; readonly motionOperationId: LaserMotionOperationId | null };
