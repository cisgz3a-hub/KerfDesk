import { coherentThinMask, hasCoherentThinDetail } from './coherent-thin-mask';
import {
  isValidRawImageData,
  prepareTraceForContour,
  type RawImageData,
  type TraceOptions,
} from './trace-image';
import { edgeTraceInputMatches, prepareEdgeTraceInput, type EdgeTraceInput } from './edge-input';
import { contourTraceInputMatches, type ContourTraceInput } from './contour-input';

const INK_LUMA_CUTOFF = 128;
const RGBA_CHANNELS = 4;

export type ContourDetailProfile = {
  readonly hasThinDetail: boolean;
  readonly transitionDensity: number;
};

/**
 * Reports whether a cleaned contour mask contains a coherent feature only a
 * few source pixels wide. Those are the features that materially benefit from
 * a 2x mask before contour extraction; broad solid artwork does not.
 */
export function hasSupersampleWorthyContourDetail(
  image: RawImageData,
  options: TraceOptions,
): boolean {
  return contourDetailProfile(image, options).hasThinDetail;
}

/** Measures narrow detail and overall mask complexity in one preprocessing pass. */
export function contourDetailProfile(
  image: RawImageData,
  options: TraceOptions,
  edgeInput?: EdgeTraceInput,
  contourInput?: ContourTraceInput,
): ContourDetailProfile {
  if (!isValidRawImageData(image)) return { hasThinDetail: false, transitionDensity: 0 };
  if (options.traceMode === 'edge') {
    const input =
      edgeInput !== undefined && edgeTraceInputMatches(edgeInput, image, options)
        ? edgeInput
        : prepareEdgeTraceInput(image, options);
    return profileInk(input.bitmap.data, input.bitmap.width, input.bitmap.height);
  }
  const prepared =
    contourInput !== undefined &&
    (options.pixelScale ?? 1) === 1 &&
    contourTraceInputMatches(contourInput, image, options)
      ? contourInput.prepared
      : prepareTraceForContour(image, { ...options, pixelScale: 1 }).prepared;
  return profileInk(inkMask(prepared), prepared.width, prepared.height);
}

function profileInk(ink: Uint8Array, width: number, height: number): ContourDetailProfile {
  return {
    hasThinDetail: hasCoherentThinDetail(ink, width, height),
    transitionDensity: maskTransitionDensity(ink, width, height),
  };
}

/** The same coherent thin features used by the quality planner, before any
 * enlargement can erase them. Specks and isolated AA boundary cells are not
 * sufficient to qualify a source region for support restoration. */
export function coherentContourDetailMask(prepared: RawImageData): Uint8Array {
  return coherentThinMask(inkMask(prepared), prepared.width, prepared.height);
}

function inkMask(image: RawImageData): Uint8Array {
  const ink = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < ink.length; pixel += 1) {
    ink[pixel] = (image.data[pixel * RGBA_CHANNELS] ?? 255) < INK_LUMA_CUTOFF ? 1 : 0;
  }
  return ink;
}

function maskTransitionDensity(ink: Uint8Array, width: number, height: number): number {
  const possibleTransitions = (width - 1) * height + (height - 1) * width;
  if (possibleTransitions <= 0) return 0;
  let transitions = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x > 0 && ink[index] !== ink[index - 1]) transitions += 1;
      if (y > 0 && ink[index] !== ink[index - width]) transitions += 1;
    }
  }
  return transitions / possibleTransitions;
}
