// Live machine state for the 3D view (ADR-255 stage 9d).
//
// Reports where the machine ACTUALLY is, from controller status reports —
// as distinct from the playback playhead, which is a simulation. Read-only:
// this subscribes to the laser store and never commands anything.
//
// Position is taken from wPos (work coordinates), which is the frame the
// Inspector already renders in, so it maps across with no transform. When
// the controller reports no wPos the marker is hidden rather than guessed
// at — a machine marker in the wrong place is worse than none.

import { useLaserStore } from '../state/laser-store';

export type LiveMachine = {
  /** Work-coordinate position, or null when the controller has not said. */
  readonly point: { readonly x: number; readonly y: number; readonly z: number } | null;
  /** A job is actively streaming. */
  readonly streaming: boolean;
  /** Acknowledged lines / total, or null when no stream is running. */
  readonly progress: { readonly completed: number; readonly total: number } | null;
  readonly feed: number | null;
  readonly spindle: number | null;
  /** GRBL run state (Idle / Run / Hold / Alarm …), or null when unknown. */
  readonly state: string | null;
};

const ACTIVE_STREAM_STATUSES: ReadonlySet<string> = new Set(['streaming', 'paused', 'tool-change']);

export function useLiveMachine(): LiveMachine {
  const statusReport = useLaserStore((store) => store.statusReport);
  const streamer = useLaserStore((store) => store.streamer);
  const streaming = streamer !== null && ACTIVE_STREAM_STATUSES.has(streamer.status);
  return {
    point: statusReport?.wPos ?? null,
    streaming,
    progress: streamer === null ? null : { completed: streamer.completed, total: streamer.total },
    feed: statusReport?.feed ?? null,
    spindle: statusReport?.spindle ?? null,
    state: statusReport?.state ?? null,
  };
}
