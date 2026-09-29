import type { TraceReport } from '../../core/trace/trace-steps';

/** Gathers what one trace request reported (see TraceReport). A scale plan or
 * lane may report more than once; a later report replaces the fields it
 * repeats. */
export type TraceReportCollector = {
  readonly add: (report: TraceReport) => void;
  /** Spread into a result: empty when nothing was reported. */
  readonly entry: () => { readonly report?: TraceReport };
};

export function collectTraceReports(): TraceReportCollector {
  let merged: TraceReport | undefined;
  return {
    add: (report) => {
      merged = { ...merged, ...report };
    },
    entry: () => (merged === undefined ? {} : { report: merged }),
  };
}
