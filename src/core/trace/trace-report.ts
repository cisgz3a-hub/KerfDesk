// Builders for the display-only TraceReport (see trace-steps.ts). Kept out of
// trace-image.ts so the preprocessing chain only gains the lines that attach
// a report where a decision is made.

import type { TraceOptions } from './trace-option-types';
import type { TraceReport } from './trace-steps';

/** What a preparation route chose, for the Trace dialog only. Spread into the
 * route's result; empty when there is nothing to show. */
export type ReportedDetection = { readonly report?: TraceReport };

/** Line Art found colour detail and added marks found by local contrast. */
export const LOCAL_DETAIL_REPORT: TraceReport = { localDetailAdded: true };

/** What the brightness route decided. An automatic cut reports its luma, or
 * that it levelled uneven lighting first and so has no single band. Line Art
 * reports that its colour check added nothing, unless Faint lines replaced
 * that check. */
export function brightnessReport(
  options: TraceOptions,
  thresholdLuma: number | null,
  levelled: boolean,
): ReportedDetection {
  const automatic =
    options.useOtsuThreshold === true &&
    options.cutoffLuma === undefined &&
    options.thresholdLuma === undefined &&
    thresholdLuma !== null;
  const checkedColour = options.autoSketchTrace === true && options.faintLineRecovery !== true;
  const report: TraceReport = {
    ...(automatic ? automaticCutReport(thresholdLuma, levelled) : {}),
    ...(checkedColour ? { localDetailAdded: false } : {}),
  };
  return Object.keys(report).length === 0 ? {} : { report };
}

function automaticCutReport(thresholdLuma: number, levelled: boolean): TraceReport {
  return levelled ? { lightingLevelled: true } : { automaticThresholdLuma: thresholdLuma };
}
