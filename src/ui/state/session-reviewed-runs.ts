// The Job Reviews this app session approved, by the run each one started
// (ADR-237 Amendment 3).
//
// Run again may carry an earlier approval only when that review happened in
// this app session, on this controller session. Neither fact survives in the
// recovery archive: a controller session number starts again from zero in a
// reloaded page, so an archived one can equal the live one by accident. This
// record therefore lives in memory only. A reload, a second window, or a run
// started by another KerfDesk has no entry here, and Run again shows Job Review.

export type SessionReviewedRun = {
  readonly runId: string;
  /** The controller session the run was reviewed and started in. */
  readonly controllerSessionEpoch: number;
  /** The warnings of the review that started this run. */
  readonly warnings: ReadonlyArray<string>;
  /** The run whose Job Review the operator confirmed with a click: this run,
   * or the first run of the repeats its review was carried through. */
  readonly operatorReviewedRunId: string;
  readonly operatorReviewedAtIso: string;
};

// Run again reads only the last completed run. A few entries cover a Start
// that was refused at the wire after its review, without growing all session.
const MAX_REMEMBERED_RUNS = 8;

const reviewedRuns = new Map<string, SessionReviewedRun>();

export function noteSessionReviewedRun(run: SessionReviewedRun): void {
  reviewedRuns.delete(run.runId);
  reviewedRuns.set(run.runId, { ...run, warnings: [...run.warnings] });
  for (const oldest of reviewedRuns.keys()) {
    if (reviewedRuns.size <= MAX_REMEMBERED_RUNS) break;
    reviewedRuns.delete(oldest);
  }
}

export function sessionReviewedRun(runId: string): SessionReviewedRun | null {
  return reviewedRuns.get(runId) ?? null;
}

/** What a page reload does to this record. For tests. */
export function forgetSessionReviewedRuns(): void {
  reviewedRuns.clear();
}
