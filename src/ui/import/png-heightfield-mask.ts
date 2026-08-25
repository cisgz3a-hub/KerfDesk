/** Build a canonical U8 inclusion mask for one exact grayscale transparent code. */
export function pngHeightfieldMaskInput(
  samples: Uint8Array,
  transparentSample: number | undefined,
  sourceBitDepth: 8 | 16,
): { readonly inclusionMask?: Uint8Array } {
  if (transparentSample === undefined) return {};
  const canonicalCode = sourceBitDepth === 8 ? transparentSample * 257 : transparentSample;
  return { inclusionMask: inclusionMaskForCode(samples, canonicalCode) };
}

function inclusionMaskForCode(samples: Uint8Array, transparentCode: number): Uint8Array {
  const sampleCount = samples.byteLength / 2;
  let mask: Uint8Array;
  try {
    mask = new Uint8Array(sampleCount);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error('Canonical height-map inclusion mask does not fit in this runtime.');
    }
    throw error;
  }
  mask.fill(0xff);
  for (let index = 0; index < sampleCount; index += 1) {
    const value = (samples[index * 2] ?? 0) | ((samples[index * 2 + 1] ?? 0) << 8);
    if (value === transparentCode) mask[index] = 0;
  }
  return mask;
}
