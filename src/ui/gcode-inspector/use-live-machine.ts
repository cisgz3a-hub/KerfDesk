// Live machine state for the 3D view (ADR-255 stage 9d).
//
// Reports where the machine ACTUALLY is, from controller status reports —
// as distinct from the playback playhead, which is a simulation. Read-only:
// this subscribes to the laser store and never commands anything.
//
// Position comes from reportedWorkPositionMm, the tree's existing derivation
// — NOT statusReport.wPos directly. GRBL 1.1 with the default $10 reports
// `MPos:` plus an intermittent `WCO:` and no `WPos:` at all, so reading wPos
// alone leaves the marker hidden on most machines. That helper also prefers
// the WCO from the same controller sample over the cache (mixing a fresh
// MPos with a stale WCO jumps the head by a whole work offset for a frame)
// and normalises inch reporting.

import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
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
  const wcoCache = useLaserStore((store) => store.wcoCache);
  const workOriginActive = useLaserStore((store) => store.workOriginActive);
  const reportInches = useLaserStore((store) => store.controllerSettings?.reportInches === true);
  const streaming = streamer !== null && ACTIVE_STREAM_STATUSES.has(streamer.status);
  return {
    point: reportedWorkPositionMm({ statusReport, wcoCache, workOriginActive }, reportInches),
    streaming,
    progress: streamer === null ? null : { completed: streamer.completed, total: streamer.total },
    feed: statusReport?.feed ?? null,
    spindle: statusReport?.spindle ?? null,
    state: statusReport?.state ?? null,
  };
}
