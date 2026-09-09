import type { RawImageData, TraceOptions } from './trace-image';

const RGBA_CHANNELS = 4;
const ALPHA_CHANNEL_OFFSET = 3;
const OPAQUE_ALPHA = 255;

/** Bind alpha interpretation to this source before deriving a crop or working grid.
 * The returned options are internal to this execution; the requested UI options
 * retain their identity for prepared-result matching and future source changes. */
export function resolveTraceSourceOptions(
  image: RawImageData,
  options: TraceOptions,
): TraceOptions {
  if (options.traceTransparency !== true || options.sourceHasTransparency !== undefined) {
    return options;
  }
  return { ...options, sourceHasTransparency: imageHasTransparency(image) };
}

/** Opaque standalone inputs retain luminance fallback; derived regions inherit
 * the full source's verdict even if cropping or resampling removed transparency. */
export function shouldTraceAlphaMask(image: RawImageData, options: TraceOptions): boolean {
  return (
    options.traceTransparency === true &&
    (options.sourceHasTransparency ?? imageHasTransparency(image))
  );
}

function imageHasTransparency(image: RawImageData): boolean {
  for (let i = ALPHA_CHANNEL_OFFSET; i < image.data.length; i += RGBA_CHANNELS) {
    if ((image.data[i] ?? OPAQUE_ALPHA) < OPAQUE_ALPHA) return true;
  }
  return false;
}
