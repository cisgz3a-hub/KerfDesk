// viewer3d-live-run — what the 3D view should show while a job is streaming.
//
// The 3D twin of the 2D live overlay: the cutter sits where the controller
// says the head is, and the path is revealed to the length the controller has
// confirmed. DISPLAY ONLY. Nothing here gates, blocks or refuses anything —
// it reports, and reporting is all it may ever do (CLAUDE.md rule 7).
//
// Feed and spindle are suppressed unless the run is actually 'running',
// matching feedBadgeText in canvas-motion-badge.tsx: a held or finished run
// reports 0, and a stopped or disconnected run's last sample is stale. A
// number that was true a minute ago is worse than no number.
//
// PURE: a run snapshot in, a view state out. No three import, no store read.

// Structurally compatible with the LiveCanvasRun fields this needs, declared
// here rather than imported so the module stays independent of the state layer
// and testable with plain literals.
export type LiveRunSnapshot = {
  readonly lifecycle: string;
  readonly reportedHead: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly route: { readonly confirmedRouteMm: number };
  readonly reportedFeedMmPerMin: number | null;
  readonly reportedSpindleRpm: number | null;
};

export type LiveViewerState = {
  // Where to draw the cutter, or null when the controller has not reported a
  // position yet. Null means "do not draw", never "draw at the origin".
  readonly headMm: { readonly x: number; readonly y: number; readonly z: number } | null;
  // Arc length to reveal the path to.
  readonly revealMm: number;
  // Null when not meaningful; the caller shows nothing rather than a stale or
  // zero value.
  readonly feedMmPerMin: number | null;
  readonly spindleRpm: number | null;
};

const RUNNING = 'running';

/**
 * Derives the 3D view state from a live run snapshot.
 *
 * @param run The current run, or null when nothing is streaming.
 * @returns The view state, or null when the 3D view should show the design
 *   rather than a run.
 */
export function liveViewerState(run: LiveRunSnapshot | null): LiveViewerState | null {
  if (run === null) return null;
  const isRunning = run.lifecycle === RUNNING;
  return {
    headMm: run.reportedHead,
    // Confirmed, not sent: the send-ahead buffer means the controller has
    // accepted more than it has executed, and revealing to the sent length
    // would draw cuts that have not happened yet.
    revealMm: run.route.confirmedRouteMm,
    feedMmPerMin: isRunning ? run.reportedFeedMmPerMin : null,
    spindleRpm: isRunning ? run.reportedSpindleRpm : null,
  };
}
