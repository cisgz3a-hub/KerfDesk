import { isBinaryContourPreset } from './contour-trace';
import { prepareContourTraceInput, type ContourTraceInput } from './contour-input';
import { cleanStaircaseSource, refusesCleanArt } from './staircase-source';
import type { RawImageData, TraceOptions } from './trace-image';
import type { TraceReport, TraceStepRunner, TraceSteps } from './trace-steps';

// A two-level source in tones other than black and white traces as its clean
// art, so every route below is the one its twin takes (ADR-530 Amendment 13).
export function asCleanArtWhereTwoLevel(
  image: RawImageData,
  options: TraceOptions,
): {
  readonly image: RawImageData;
  readonly options: TraceOptions;
  readonly contourInput?: ContourTraceInput;
  /** The source's own preparation, for Sharp's trace on the source grid. */
  readonly nativeInput?: ContourTraceInput;
  readonly report?: TraceReport;
} {
  if (!isBinaryContourPreset(options)) return { image, options };
  // The presets that may enlarge carry their input into the scale plan, which
  // routes on it. Sharp's goes only to a trace on the source grid, and Sharp
  // skips the preparation when the check would refuse anyway, so it prepares
  // its source once, as before Amendment 13 (perf audit S5-P3-1).
  const enlarging = options.supersampleContour === true;
  if (!enlarging && refusesCleanArt(image, options)) return { image, options };
  const carried = (input: ContourTraceInput): { readonly contourInput?: ContourTraceInput } =>
    enlarging ? { contourInput: input } : {};
  const native = prepareContourTraceInput(image, options);
  const clean = cleanStaircaseSource(image, options, native);
  if (clean === null) {
    return { image, options, ...(enlarging ? { contourInput: native } : { nativeInput: native }) };
  }
  return {
    ...clean,
    ...carried(prepareContourTraceInput(clean.image, clean.options)),
    ...(native.report === undefined ? {} : { report: native.report }),
  };
}

export function reportingAs(run: TraceStepRunner, report: TraceReport): TraceStepRunner {
  return (steps) => run(withReport(steps, report));
}

function* withReport<T>(steps: TraceSteps<T>, report: TraceReport): TraceSteps<T> {
  let step = steps.next();
  while (step.done !== true) step = steps.next(yield step.value === undefined ? undefined : report);
  return step.value;
}
