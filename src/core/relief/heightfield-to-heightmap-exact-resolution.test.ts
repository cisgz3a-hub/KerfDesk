import { describe, expect, it } from 'vitest';
import { decodeCanonicalBase64 } from './depth-map-base64';
import { reliefHeightfieldDigest } from './heightfield-digest';
import { heightfieldToHeightmap } from './heightfield-to-heightmap';
import { createReliefHeightfield, u16ValuesToLittleEndian } from './relief-heightfield-factory';

function source(physicalWidthMm: number, physicalHeightMm: number, inclusionMask?: Uint8Array) {
  return createReliefHeightfield({
    width: 2,
    height: 1,
    physicalWidthMm,
    physicalHeightMm,
    samples: u16ValuesToLittleEndian([0, 0xffff]),
    ...(inclusionMask === undefined ? {} : { inclusionMask }),
    mapping: {
      polarity: 'light-is-high',
      inputLowCode: 0,
      inputHighCode: 0xffff,
      curve: { kind: 'gamma-v1', gamma: 1 },
      maxDepthMm: 5,
      crop: { kind: 'normalized-v1', x: 0, y: 0, width: 1, height: 1 },
      aspect: 'preserve',
      inclusionThreshold: 255,
      outsideMask: 'excluded',
    },
    provenance: {
      sourceKind: 'depth-map',
      sourceName: 'exact-resolution-test.png',
      sourceBitDepth: 16,
      sourcePolarity: 'light-is-high',
    },
  });
}

describe('heightfieldToHeightmap exact resolution', () => {
  it('attempts the exact field above the advisory threshold and reports RangeError', () => {
    const field = source(2001, 2000);
    let attemptedLength: number | undefined;
    const result = heightfieldToHeightmap(
      field,
      { targetWidthMm: 2001, reliefDepthMm: 5, mmPerCell: 1 },
      {
        decodeBase64: decodeCanonicalBase64,
        digest: reliefHeightfieldDigest,
        allocateFloat32: (length) => {
          attemptedLength = length;
          throw new RangeError('controlled allocation failure');
        },
      },
    );

    expect(attemptedLength).toBe(2001 * 2000);
    expect(attemptedLength).toBeGreaterThan(4_000_000);
    expect(result).toEqual({
      kind: 'error',
      reason: 'Relief heightfield does not fit in this runtime.',
    });
  });

  it('turns a native typed-array allocation RangeError into a structured result', () => {
    const field = source(Number.MAX_VALUE, 1);

    expect(
      heightfieldToHeightmap(field, {
        targetWidthMm: Number.MAX_VALUE,
        reliefDepthMm: 5,
        mmPerCell: Number.MIN_VALUE,
      }),
    ).toEqual({
      kind: 'error',
      reason: 'Relief heightfield does not fit in this runtime.',
    });
  });

  // The fixture requests two cells, so -2 also covers a zero-length return.
  it.each([-2, -1, 1])('rejects depth and mask allocations whose lengths differ by %i', (delta) => {
    const field = source(2, 1);
    expect(
      heightfieldToHeightmap(
        field,
        { targetWidthMm: 2, reliefDepthMm: 5, mmPerCell: 1 },
        {
          decodeBase64: decodeCanonicalBase64,
          digest: reliefHeightfieldDigest,
          allocateFloat32: (length) => new Float32Array(Math.max(0, length + delta)),
        },
      ),
    ).toEqual({
      kind: 'error',
      reason: 'Relief heightfield does not fit in this runtime.',
    });

    const masked = source(2, 1, new Uint8Array([255, 0]));
    expect(
      heightfieldToHeightmap(
        masked,
        { targetWidthMm: 2, reliefDepthMm: 5, mmPerCell: 1 },
        {
          decodeBase64: decodeCanonicalBase64,
          digest: reliefHeightfieldDigest,
          allocateUint8: (length) => new Uint8Array(Math.max(0, length + delta)),
        },
      ),
    ).toEqual({
      kind: 'error',
      reason: 'Relief heightfield does not fit in this runtime.',
    });
  });

  it('rethrows a non-allocation heightmap allocator failure', () => {
    const programmerError = new Error('controlled heightmap allocator error');
    const field = source(2, 1);

    expect(() =>
      heightfieldToHeightmap(
        field,
        { targetWidthMm: 2, reliefDepthMm: 5, mmPerCell: 1 },
        {
          decodeBase64: decodeCanonicalBase64,
          digest: reliefHeightfieldDigest,
          allocateFloat32: () => {
            throw programmerError;
          },
        },
      ),
    ).toThrow(programmerError);
  });

  it('rethrows a non-allocation inclusion allocator failure', () => {
    const programmerError = new Error('controlled inclusion allocator error');
    const masked = source(2, 1, new Uint8Array([255, 0]));

    expect(() =>
      heightfieldToHeightmap(
        masked,
        { targetWidthMm: 2, reliefDepthMm: 5, mmPerCell: 1 },
        {
          decodeBase64: decodeCanonicalBase64,
          digest: reliefHeightfieldDigest,
          allocateUint8: () => {
            throw programmerError;
          },
        },
      ),
    ).toThrow(programmerError);
  });
});
