// laser-alarm-stream-end — how a controller alarm (an `ALARM:` line or an
// Alarm status report) or Sleep ends the job stream. Split from
// laser-status-line at the 400-line cap.
//
// An alarm that reaches a 'done' stream ends the run too (rolling audit
// 2026-10-21, 05-P2-2). 'done' means every line was acknowledged, not that the
// controller ran them: Smoothieware answers a move once it is queued and holds
// up to 32 (GcodeDispatch.cpp, Conveyor.cpp `planner_queue_size`), and its
// kill button or a hard limit flushes that queue (Conveyor::on_halt). The
// streamer keeps 'done' terminal, so the run went on looking finished: the
// alarm dropped the post-job settle, the next Idle released the stream as an
// unexplained stop with no planner step-back, and recovery skipped the moves
// the controller threw away. The run now ends 'cancelled', as the same alarm
// one acknowledgement earlier ends it, so it is recorded as a stop that
// discarded the planner, with the usual step-back (checkpoint-interruption.ts).
// A 'done' stream stays in the store only until the post-job settle has seen
// its marker and fresh Idle, so every alarm that reaches one arrived before
// the controller confirmed the motion.

import { cancel, wipeInFlight, type StreamerState } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';

/** The stream an alarm leaves behind when its lines were all acknowledged
 * but the motion was not yet confirmed. */
export function alarmEndsUnsettledRunPatch(
  streamer: StreamerState | null,
): Partial<Pick<LaserState, 'streamer'>> {
  return streamer?.status === 'done' ? { streamer: wipeInFlight(cancel(streamer)) } : {};
}

/** The stream an Alarm or Sleep status report leaves behind. */
export function cancelActiveStreamerPatch(
  streamer: StreamerState | null,
  alarm: boolean,
): Partial<Pick<LaserState, 'streamer'>> {
  if (streamer === null) return {};
  if (alarm && streamer.status === 'done') return alarmEndsUnsettledRunPatch(streamer);
  // 'tool-change' is an active hold (M0 queued, pre-M0 motion may be draining):
  // an Alarm there wiped the firmware buffer just as during streaming/paused, so
  // cancel it too (Codex audit: status list not updated when tool-change landed).
  if (!['idle', 'streaming', 'paused', 'tool-change'].includes(streamer.status)) return {};
  // Alarm = the firmware wiped its buffer; in-flight lines will never be
  // acked, so drop them from the accounting too (audit F1).
  return { streamer: wipeInFlight(cancel(streamer)) };
}
