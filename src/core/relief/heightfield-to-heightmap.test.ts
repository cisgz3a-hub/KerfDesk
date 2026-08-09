import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ReliefHeightfield } from '../scene/relief';
import { decodeCanonicalBase64 } from './depth-map-base64';
import { reliefHeightfieldDigest } from './heightfield-digest';
import { materialize, source } from './heightfield-to-heightmap-test-helpers';
import {
  heightfieldToHeightmap,
  type HeightfieldMaterializationRuntime,
} from './heightfield-to-heightmap';

describe('heightfieldToHeightmap', () => {
  it('maps the full U16 range to physical depth with explicit polarity', () => {
    const high = materialize(source({ values: [0, 0xffff] }));
    const deep = materialize(
      source({ values: [0, 0xffff], mapping: { polarity: 'light-is-deep' } }),
    );

    expect(high.kind).toBe('ok');
    expect(deep.kind).toBe('ok');
    if (high.kind !== 'ok' || deep.kind !== 'ok') return;
    expect([...high.heightmap.depth]).toEqual([-5, 0]);
    expect([...deep.heightmap.depth]).toEqual([0, -5]);
  });

  it('applies input levels, gamma, and normalized crop before physical depth', () => {
    const field = source({
      values: [0, 0x4000, 0x8000, 0xffff],
      width: 4,
      physicalWidthMm: 2,
      maxDepthMm: 10,
      mapping: {
        inputLowCode: 0x4000,
        inputHighCode: 0xffff,
        curve: { kind: 'gamma-v1', gamma: 2 },
        crop: { kind: 'normalized-v1', x: 0.25, y: 0, width: 0.5, height: 1 },
      },
    });
    const result = materialize(field);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect([...result.heightmap.depth]).toHaveLength(2);
    expect(result.heightmap.depth[0]).toBe(-10);
    const normalized = (0x8000 - 0x4000) / (0xffff - 0x4000);
    expect(result.heightmap.depth[1]).toBeCloseTo(-10 * (1 - normalized ** 2), 6);
  });

  it('defines equal input levels as a deterministic flat midpoint', () => {
    for (const polarity of ['light-is-high', 'light-is-deep'] as const) {
      const result = materialize(
        source({
          values: [0, 12345, 0xffff],
          mapping: { polarity, inputLowCode: 1000, inputHighCode: 1000 },
        }),
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') expect([...result.heightmap.depth]).toEqual([-2.5, -2.5, -2.5]);
    }
  });

  it('preserves field dimensions under explicit physical XY scaling', () => {
    const field = source({
      values: [0, 1, 2, 3],
      width: 2,
      height: 2,
      physicalWidthMm: 10,
      physicalHeightMm: 10,
      maxDepthMm: 4,
    });
    const result = heightfieldToHeightmap(field, {
      targetWidthMm: 10,
      reliefDepthMm: 4,
      targetScaleX: 2,
      targetScaleY: 0.5,
      mmPerCell: 1,
    });

    expect(result).toMatchObject({ kind: 'ok', widthMm: 20, heightMm: 5 });
  });

  it('treats aspect as the policy that produced resolved dimensions, not a second CAM transform', () => {
    const common = {
      values: [0, 0xffff],
      width: 2,
      height: 1,
      physicalWidthMm: 10,
      physicalHeightMm: 7,
      maxDepthMm: 4,
    };
    const preserve = materialize(source({ ...common, mapping: { aspect: 'preserve' } }));
    const stretch = materialize(source({ ...common, mapping: { aspect: 'stretch' } }));

    expect(stretch).toEqual(preserve);
    expect(stretch).toMatchObject({ kind: 'ok', widthMm: 10, heightMm: 7 });
  });

  it('uses the highest source surface without expanding excluded coarse coverage', () => {
    const full = materialize(
      source({ values: [0, 0xffff], physicalWidthMm: 1, physicalHeightMm: 1 }),
    );
    const masked = materialize(
      source({
        values: [0, 0xffff],
        mask: [255, 0],
        physicalWidthMm: 1,
        physicalHeightMm: 1,
      }),
    );

    expect(full.kind).toBe('ok');
    expect(masked.kind).toBe('ok');
    if (full.kind !== 'ok' || masked.kind !== 'ok') return;
    expect([...full.heightmap.depth]).toEqual([0]);
    expect([...masked.heightmap.depth]).toEqual([0]);
    expect([...masked.heightmap.inclusion!]).toEqual([0]);
  });

  it('samples a terminal partial cell from its exact physical source footprint', () => {
    const values = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000];
    const field = source({
      values,
      width: values.length,
      physicalWidthMm: 1,
      physicalHeightMm: 0.3,
    });
    const result = materialize(field, 0.3);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.heightmap).toMatchObject({
      widthCells: 4,
      heightCells: 1,
      widthMm: 1,
      heightMm: 0.3,
      mmPerCell: 0.3,
    });
    const expectedCodes = [3000, 6000, 9000, 10_000];
    expectedCodes.forEach((code, index) => {
      expect(result.heightmap.depth[index]).toBeCloseTo(-5 * (1 - code / 0xffff), 5);
    });

    const masked = materialize(
      source({
        values,
        width: values.length,
        mask: [255, 255, 255, 255, 255, 255, 255, 255, 255, 0],
        physicalWidthMm: 1,
        physicalHeightMm: 0.3,
      }),
      0.3,
    );
    expect(masked.kind).toBe('ok');
    if (masked.kind === 'ok') expect([...masked.heightmap.inclusion!]).toEqual([1, 1, 1, 0]);
  });

  it('retains every U8 mask value and applies the declared threshold and outside meaning', () => {
    const base = {
      values: [0xffff, 0xffff, 0xffff, 0xffff],
      mask: [0, 1, 254, 255],
      maxDepthMm: 5,
    };
    const excluded = materialize(source(base));
    const top = materialize(
      source({ ...base, mapping: { outsideMask: 'stock-top', inclusionThreshold: 255 } }),
    );
    const floor = materialize(
      source({ ...base, mapping: { outsideMask: 'relief-floor', inclusionThreshold: 255 } }),
    );
    const thresholdOne = materialize(
      source({ ...base, mapping: { outsideMask: 'excluded', inclusionThreshold: 1 } }),
    );

    expect(excluded.kind).toBe('ok');
    expect(top.kind).toBe('ok');
    expect(floor.kind).toBe('ok');
    expect(thresholdOne.kind).toBe('ok');
    if (
      excluded.kind !== 'ok' ||
      top.kind !== 'ok' ||
      floor.kind !== 'ok' ||
      thresholdOne.kind !== 'ok'
    ) {
      return;
    }
    expect([...excluded.heightmap.inclusion!]).toEqual([0, 0, 0, 1]);
    expect([...top.heightmap.depth]).toEqual([0, 0, 0, 0]);
    expect(top.heightmap.inclusion).toBeUndefined();
    expect([...floor.heightmap.depth]).toEqual([-5, -5, -5, 0]);
    expect([...thresholdOne.heightmap.inclusion!]).toEqual([0, 1, 1, 1]);
  });

  it('rejects a changed payload whose digest no longer matches', () => {
    const field = source({ values: [0, 0xffff] });
    const changed = { ...field, samplesBase64: 'AAAAAA==' };
    expect(materialize(changed)).toMatchObject({
      kind: 'error',
      reason: expect.stringMatching(/digest/),
    });
  });

  it('returns compile-integrity errors for malformed payloads and crop metadata', () => {
    const field = source({ values: [0, 0xffff] });
    const badPayload = { ...field, samplesBase64: 7 } as unknown as ReliefHeightfield;
    const badCrop = {
      ...field,
      mapping: {
        ...field.mapping,
        crop: { ...field.mapping.crop, x: 0.75, width: 0.5 },
      },
    } as ReliefHeightfield;

    expect(materialize(badPayload)).toMatchObject({
      kind: 'error',
      reason: expect.stringMatching(/base64 text/),
    });
    expect(materialize(badCrop)).toMatchObject({
      kind: 'error',
      reason: expect.stringMatching(/crop/),
    });
  });

  it('preserves allocation-specific sample, mask, and digest failures', () => {
    const options = {
      targetWidthMm: 2,
      reliefDepthMm: 5,
      mmPerCell: 1,
    };
    const cases: ReadonlyArray<{
      readonly field: ReliefHeightfield;
      readonly runtime: HeightfieldMaterializationRuntime;
      readonly reason: string;
    }> = [
      {
        field: source({ values: [0, 0xffff] }),
        runtime: {
          decodeBase64: () => ({
            kind: 'error',
            code: 'allocation',
            reason: 'controlled sample allocation failure',
          }),
          digest: reliefHeightfieldDigest,
        },
        reason: 'Relief heightfield sample payload does not fit in this runtime.',
      },
      {
        field: source({ values: [0, 0xffff], mask: [255, 0] }),
        runtime: materializationRuntimeWithSecondDecodeAllocationFailure(),
        reason: 'Relief heightfield mask payload does not fit in this runtime.',
      },
      {
        field: source({ values: [0, 0xffff] }),
        runtime: {
          decodeBase64: decodeCanonicalBase64,
          digest: () => {
            throw new RangeError('controlled digest allocation failure');
          },
        },
        reason: 'Relief heightfield digest does not fit in this runtime.',
      },
    ];

    for (const item of cases) {
      let result: ReturnType<typeof heightfieldToHeightmap> | undefined;
      expect(() => {
        result = heightfieldToHeightmap(item.field, options, item.runtime);
      }).not.toThrow();
      expect(result).toEqual({
        kind: 'error',
        reason: item.reason,
      });
    }
  });

  it('rethrows a non-allocation materialization dependency failure', () => {
    const programmerError = new Error('controlled materializer error');
    const field = source({ values: [0, 0xffff] });

    expect(() =>
      heightfieldToHeightmap(
        field,
        { targetWidthMm: 2, reliefDepthMm: 5, mmPerCell: 1 },
        {
          decodeBase64: () => {
            throw programmerError;
          },
          digest: reliefHeightfieldDigest,
        },
      ),
    ).toThrow(programmerError);
  });

  it('rejects a non-literal outside-mask value without invoking object coercion', () => {
    const field = source({ values: [0, 0xffff] });
    const invalid = {
      ...field,
      mapping: { ...field.mapping, outsideMask: { toString: null } },
    } as unknown as ReliefHeightfield;

    expect(() => materialize(invalid)).not.toThrow();
    expect(materialize(invalid)).toMatchObject({
      kind: 'error',
      reason: expect.stringMatching(/outside-mask/),
    });
  });

  it('preserves physical dimensions and the highest surface over random U16 fields', () => {
    fc.assert(
      fc.property(heightfieldCase(), ({ width, height, polarity, values, options }) => {
        const field = source({
          values,
          width,
          height,
          physicalWidthMm: options.targetWidthMm,
          physicalHeightMm: options.targetWidthMm * (height / width),
          maxDepthMm: options.reliefDepthMm,
          mapping: { polarity },
        });
        const widthMm = field.physicalWidthMm * options.targetScaleX;
        const heightMm = field.physicalHeightMm * options.targetScaleY;
        const result = heightfieldToHeightmap(field, {
          ...options,
          mmPerCell: Math.max(widthMm, heightMm),
        });

        expect(result).toMatchObject({ kind: 'ok', widthMm, heightMm });
        if (result.kind !== 'ok') return;
        const expected = Math.max(
          ...values.map((value) =>
            polarity === 'light-is-high'
              ? -options.reliefDepthMm * (1 - value / 0xffff)
              : -options.reliefDepthMm * (value / 0xffff),
          ),
        );
        expect(result.heightmap.depth).toHaveLength(1);
        expect(result.heightmap.depth[0]).toBeCloseTo(expected, 4);
      }),
      { numRuns: 80 },
    );
  });
});

function materializationRuntimeWithSecondDecodeAllocationFailure(): HeightfieldMaterializationRuntime {
  let calls = 0;
  return {
    decodeBase64: (value) => {
      calls += 1;
      return calls === 1
        ? decodeCanonicalBase64(value)
        : {
            kind: 'error',
            code: 'allocation',
            reason: 'controlled mask allocation failure',
          };
    },
    digest: reliefHeightfieldDigest,
  };
}

function heightfieldCase() {
  return fc
    .record({
      width: fc.integer({ min: 1, max: 4 }),
      height: fc.integer({ min: 1, max: 4 }),
      polarity: fc.constantFrom<'light-is-high' | 'light-is-deep'>(
        'light-is-high',
        'light-is-deep',
      ),
    })
    .chain(({ width, height, polarity }) =>
      fc.record({
        width: fc.constant(width),
        height: fc.constant(height),
        polarity: fc.constant(polarity),
        values: fc.array(fc.integer({ min: 0, max: 0xffff }), {
          minLength: width * height,
          maxLength: width * height,
        }),
        options: fc.record({
          targetWidthMm: fc.double({ min: 1, max: 100, noNaN: true, noDefaultInfinity: true }),
          reliefDepthMm: fc.double({ min: 0.1, max: 20, noNaN: true, noDefaultInfinity: true }),
          targetScaleX: fc.double({ min: 0.1, max: 3, noNaN: true, noDefaultInfinity: true }),
          targetScaleY: fc.double({ min: 0.1, max: 3, noNaN: true, noDefaultInfinity: true }),
        }),
      }),
    );
}
