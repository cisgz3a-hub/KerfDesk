import { isBinaryContourPreset } from './contour-trace';
import { prepareContourTraceInput, type ContourTraceInput } from './contour-input';
import { cleanStaircaseSource } from './staircase-source';
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
  readonly report?: TraceReport;
} {
  if (!isBinaryContourPreset(options)) return { image, options };
  // Sharp prepares its input as it traces; only the presets that may enlarge carry it.
  const carried = (input: ContourTraceInput): { readonly contourInput?: ContourTraceInput } =>
    options.supersampleContour === true ? { contourInput: input } : {};
  const native = prepareContourTraceInput(image, options);
  const clean = cleanStaircaseSource(image, options, native);
  if (clean === null) return { image, options, ...carried(native) };
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
