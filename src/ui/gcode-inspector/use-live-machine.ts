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

import { useStoreWithEqualityFn } from 'zustand/traditional';
import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { useLaserStore } from '../state/laser-store';

type LaserState = ReturnType<typeof useLaserStore.getState>;

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

/**
 * Subscribed by VALUE, not by object identity. The 250 ms poll replaces
 * `statusReport` on every tick even when the controller repeated itself, and
 * the streamer object is replaced on every ack during a burn; watching those
 * objects re-rendered the whole Inspector view four times a second at idle
 * and once per acknowledged line under load.
 */
export function useLiveMachine(): LiveMachine {
  return useStoreWithEqualityFn(useLaserStore, selectLiveMachine, liveMachineEqual);
}

function selectLiveMachine(store: LaserState): LiveMachine {
  const { statusReport, streamer, wcoCache, workOriginActive } = store;
  const reportInches = store.controllerSettings?.reportInches === true;
  return {
    point: reportedWorkPositionMm({ statusReport, wcoCache, workOriginActive }, reportInches),
    streaming: streamer !== null && ACTIVE_STREAM_STATUSES.has(streamer.status),
    progress: streamer === null ? null : { completed: streamer.completed, total: streamer.total },
    feed: statusReport?.feed ?? null,
    spindle: statusReport?.spindle ?? null,
    state: statusReport?.state ?? null,
  };
}

function liveMachineEqual(a: LiveMachine, b: LiveMachine): boolean {
  return (
    a.streaming === b.streaming &&
    a.state === b.state &&
    a.feed === b.feed &&
    a.spindle === b.spindle &&
    progressEqual(a.progress, b.progress) &&
    pointEqual(a.point, b.point)
  );
}

function progressEqual(a: LiveMachine['progress'], b: LiveMachine['progress']): boolean {
  if (a === null || b === null) return a === b;
  return a.completed === b.completed && a.total === b.total;
}

function pointEqual(a: LiveMachine['point'], b: LiveMachine['point']): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
