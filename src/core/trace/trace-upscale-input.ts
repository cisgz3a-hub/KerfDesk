import { upscaleBy } from './auto-upscale';
import { prepareContourTraceInput, type ContourTraceInput } from './contour-input';
import { restoreEnlargedContourSupport } from './contour-support';
import type { EdgeTraceInput } from './edge-input';
import type { RawImageData, TraceOptions } from './trace-image';

type UpscaledTraceInput = {
  readonly image: RawImageData;
  readonly options: TraceOptions;
  readonly contourInput: ContourTraceInput | undefined;
};

/** Prepare one enlarged execution without repeating accepted source cleanup. */
export function prepareUpscaledTraceInput(
  image: RawImageData,
  options: TraceOptions,
  factor: number,
  edgeInput?: EdgeTraceInput,
  contourInput?: ContourTraceInput,
): UpscaledTraceInput {
  // AUTO repairs source-grid impulses once; a forced median keeps its
  // working-grid order. Bilinear sampling still supplies the measured edges.
  // The reused source already carries any Invert, so it is not applied twice.
  const reuseCleanedEdge = edgeInput !== undefined && options.edgeMedianFilter !== true;
  const scaledOptions: TraceOptions = {
    ...options,
    pixelScale: factor,
    ...(reuseCleanedEdge ? { edgeMedianFilter: false, invert: false } : {}),
  };
  const enlarged = upscaleBy(reuseCleanedEdge ? edgeInput.source : image, factor);
  const preparedInput =
    contourInput === undefined ? undefined : prepareContourTraceInput(enlarged, scaledOptions);
  // Gray hairlines can brighten past the cut; Otsu can also change its cut.
  // Restore admitted detail locally without losing other supersampled edges.
  return {
    image: enlarged,
    options: scaledOptions,
    contourInput:
      contourInput !== undefined && preparedInput !== undefined
        ? restoreEnlargedContourSupport(contourInput, preparedInput, factor)
        : preparedInput,
  };
}
