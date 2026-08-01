import { describe, expect, it } from 'vitest';
import { editorHorizontalMaskRepair } from './editor-horizontal-mask-repair';

function repair(alpha: ReadonlyArray<number>, radiusPx = 1, correctionMm = 0.75) {
  return editorHorizontalMaskRepair({
    seed: { width: alpha.length, height: 1, alpha: Uint8Array.from(alpha) },
    radiusPx,
    minXWorldMm: 0,
    pixelWidthMm: 1,
    dotWidthCorrectionMm: correctionMm,
    sourceSValues: Uint16Array.from(alpha, (value) => (value > 0 ? 1000 : 0)),
    filledS: 1000,
    outputMaskFor: (mask) => mask,
  });
}

describe('editorHorizontalMaskRepair', () => {
  it('grows only along a scan row and preserves separate rows', () => {
    const result = editorHorizontalMaskRepair({
      seed: { width: 3, height: 2, alpha: Uint8Array.of(0, 255, 0, 0, 0, 0) },
      radiusPx: 1,
      minXWorldMm: 0,
      pixelWidthMm: 1,
      dotWidthCorrectionMm: 0.75,
      sourceSValues: Uint16Array.of(0, 1000, 0, 0, 0, 0),
      filledS: 1000,
      outputMaskFor: (mask) => mask,
    });
    expect(result?.alpha).toEqual(Uint8Array.of(255, 255, 255, 0, 0, 0));
  });

  it('uses one-sided edge growth that still survives strict correction', () => {
    expect(repair([255, 0, 0])?.alpha).toEqual(Uint8Array.of(255, 255, 0));
  });

  it('rejects a clipped repair when the whole row still disappears', () => {
    expect(repair([255], 1, 0.75)).toBeNull();
  });

  it('requires both forward and reverse emitter operands to survive', () => {
    expect(
      editorHorizontalMaskRepair({
        seed: { width: 42, height: 1, alpha: Uint8Array.from({ length: 42 }, () => 255) },
        radiusPx: 1,
        minXWorldMm: 0.1,
        pixelWidthMm: 0.02,
        dotWidthCorrectionMm: 0.41,
        sourceSValues: Uint16Array.from({ length: 42 }, () => 1000),
        filledS: 1000,
        outputMaskFor: (mask) => mask,
      }),
    ).not.toBeNull();
  });

  it('rejects a non-binary mapped repair mask', () => {
    expect(
      editorHorizontalMaskRepair({
        seed: { width: 2, height: 1, alpha: Uint8Array.of(255, 0) },
        radiusPx: 1,
        minXWorldMm: 0,
        pixelWidthMm: 1,
        dotWidthCorrectionMm: 0.75,
        sourceSValues: Uint16Array.of(1000, 0),
        filledS: 1000,
        outputMaskFor: () => ({ width: 2, height: 1, alpha: Uint8Array.of(128, 255) }),
      }),
    ).toBeNull();
  });

  it('rejects a repair that shortens a surviving grayscale run into a new loss', () => {
    expect(
      editorHorizontalMaskRepair({
        seed: { width: 3, height: 1, alpha: Uint8Array.of(255, 0, 0) },
        radiusPx: 1,
        minXWorldMm: 0,
        pixelWidthMm: 1,
        dotWidthCorrectionMm: 0.75,
        sourceSValues: Uint16Array.of(1000, 608, 608),
        filledS: 1000,
        outputMaskFor: (mask) => mask,
      }),
    ).toBeNull();
  });

  it('retains a repair when every complete post-fill power run survives', () => {
    expect(
      editorHorizontalMaskRepair({
        seed: { width: 4, height: 1, alpha: Uint8Array.of(255, 0, 0, 0) },
        radiusPx: 1,
        minXWorldMm: 0,
        pixelWidthMm: 1,
        dotWidthCorrectionMm: 0.75,
        sourceSValues: Uint16Array.of(1000, 0, 608, 608),
        filledS: 1000,
        outputMaskFor: (mask) => mask,
      })?.alpha,
    ).toEqual(Uint8Array.of(255, 255, 0, 0));
  });
});
