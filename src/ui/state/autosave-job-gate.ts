// Whether an interval autosave may run while a job streams (ADR-305
// Amendment 1, annoyance audit A4-P2-1).
//
// A job needs the canvas thread: it refills the controller on the window
// route, and Pause and Abort start there on every route. An autosave is let
// through during a job only while three things hold, so that what it costs
// that thread stays a few milliseconds:
//
//   1. The project is light: its hand-off, the one part of an autosave that
//      cannot leave the canvas thread, is short, and the copy its worker
//      builds is small enough not to press on the machine's memory.
//   2. No hand-off measured during this job ran over its limit. The estimate
//      in (1) is a model; this is the machine it is running on.
//   3. The last write reached IndexedDB. The localStorage fallback writes the
//      whole project text synchronously on the canvas thread.
//
// A project that does not pass waits for the job to end, as every project did
// before, and the status bar says so.

import type { Project } from '../../core/scene';
import type { AutosaveDurableWriteResult } from './autosave-durable';
import { autosaveHandOffWeight } from './autosave-hand-off-weight';
import { lastAutosaveHandOffMs } from './autosave-preparation-client';

/**
 * At most 20-30 ms of hand-off, and a recovery copy of about 30 million
 * characters, in the measurements that set the weights.
 */
export const AUTOSAVE_JOB_HAND_OFF_WEIGHT_LIMIT = 30_000_000;
/** A measured hand-off longer than this ends autosave for the rest of the job. */
export const AUTOSAVE_JOB_HAND_OFF_LIMIT_MS = 30;

export type AutosaveJobGate = {
  /** Whether `project` may be handed to the autosave worker while a job runs. */
  readonly allows: (project: Project) => boolean;
  /** Each tick's job state. A job that ended takes its measurements with it. */
  readonly noteJob: (active: boolean) => void;
  /** A finished write, and whether a job was running when it was handed off. */
  readonly noteWrite: (result: AutosaveDurableWriteResult, duringJob: boolean) => void;
};

export function createAutosaveJobGate(
  handOffMs: () => number | null = lastAutosaveHandOffMs,
): AutosaveJobGate {
  let reachedIndexedDb = true;
  let slowHandOffThisJob = false;
  return {
    allows: (project) =>
      reachedIndexedDb &&
      !slowHandOffThisJob &&
      autosaveHandOffWeight(project) <= AUTOSAVE_JOB_HAND_OFF_WEIGHT_LIMIT,
    noteJob: (active) => {
      if (!active) slowHandOffThisJob = false;
    },
    noteWrite: (result, duringJob) => {
      // A superseded write says nothing about storage: a newer copy won.
      if (result.kind !== 'superseded') {
        reachedIndexedDb = result.kind === 'ok' && result.backend === 'indexeddb';
      }
      if (duringJob && (handOffMs() ?? 0) > AUTOSAVE_JOB_HAND_OFF_LIMIT_MS) {
        slowHandOffThisJob = true;
      }
    },
  };
}
