import { autoMedianFilter, medianFilter } from './preprocess';
import type { RawImageData } from './trace-image';

// Forced median and selective automatic cleanup have different contracts. The
// automatic path computes and applies its result once, preserving connected ink.
// Kept out of preprocess.ts so the median stage's callers (trace-image,
// trace-source-decisions) share it without growing the preprocessing module.
export function applyMedian(
  image: RawImageData,
  medianFilterOption: boolean | 'auto' | undefined,
): RawImageData {
  if (medianFilterOption === 'auto') return autoMedianFilter(image);
  return medianFilterOption === true ? medianFilter(image) : image;
}
