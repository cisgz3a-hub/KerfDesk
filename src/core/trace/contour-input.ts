import { prepareTraceForContour, type RawImageData, type TraceOptions } from './trace-image';

/** One request's prepared mask and measured edge field. No cross-request cache. */
export type ContourTraceInput = ReturnType<typeof prepareTraceForContour> & {
  readonly image: RawImageData;
  readonly options: TraceOptions;
};

export function prepareContourTraceInput(
  image: RawImageData,
  options: TraceOptions,
): ContourTraceInput {
  return { image, options, ...prepareTraceForContour(image, options) };
}

/** Prepared state belongs to this immutable source and this execution's options. */
export function contourTraceInputMatches(
  input: ContourTraceInput,
  image: RawImageData,
  options: TraceOptions,
): boolean {
  return input.image === image && input.options === options;
}
