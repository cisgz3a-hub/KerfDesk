import {
  createReliefHeightfield,
  u16ValuesToLittleEndian,
} from '../core/relief/relief-heightfield-factory';
import type {
  ReliefHeightfield,
  ReliefHeightfieldMapping,
  ReliefHeightfieldProvenance,
} from '../core/scene/relief';

export type TestReliefHeightfieldInput = {
  readonly width: number;
  readonly height: number;
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
  readonly maxDepthMm: number;
  readonly samplesU16?: ReadonlyArray<number>;
  readonly samplesU8?: ReadonlyArray<number>;
  readonly inclusionMask?: ReadonlyArray<number>;
  readonly mapping?: Partial<ReliefHeightfieldMapping>;
  readonly provenance?: Partial<ReliefHeightfieldProvenance>;
  readonly revision?: number;
};

/** Build an internally consistent canonical source for cross-layer tests. */
export function testReliefHeightfield(input: TestReliefHeightfieldInput): ReliefHeightfield {
  const values =
    input.samplesU16 ?? input.samplesU8?.map((value) => value * 257) ?? defaultSamples(input);
  const mapping: ReliefHeightfieldMapping = {
    polarity: 'light-is-high',
    inputLowCode: 0,
    inputHighCode: 0xffff,
    curve: { kind: 'gamma-v1', gamma: 1 },
    maxDepthMm: input.maxDepthMm,
    crop: { kind: 'normalized-v1', x: 0, y: 0, width: 1, height: 1 },
    aspect: 'preserve',
    inclusionThreshold: 255,
    outsideMask: 'excluded',
    ...input.mapping,
  };
  return createReliefHeightfield({
    width: input.width,
    height: input.height,
    physicalWidthMm: input.physicalWidthMm,
    physicalHeightMm: input.physicalHeightMm,
    samples: u16ValuesToLittleEndian(values),
    ...(input.inclusionMask === undefined
      ? {}
      : { inclusionMask: Uint8Array.from(input.inclusionMask) }),
    mapping,
    provenance: {
      sourceKind: 'depth-map',
      sourceName: 'test-heightfield.png',
      sourceBitDepth: input.samplesU8 === undefined ? 16 : 8,
      sourcePolarity: mapping.polarity,
      ...input.provenance,
    },
    ...(input.revision === undefined ? {} : { revision: input.revision }),
  });
}

function defaultSamples(input: TestReliefHeightfieldInput): ReadonlyArray<number> {
  return Array.from({ length: input.width * input.height }, () => 0xffff);
}
