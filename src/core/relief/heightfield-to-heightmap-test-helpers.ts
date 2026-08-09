import type { ReliefHeightfield, ReliefHeightfieldMapping } from '../scene/relief';
import { heightfieldToHeightmap } from './heightfield-to-heightmap';
import { createReliefHeightfield, u16ValuesToLittleEndian } from './relief-heightfield-factory';

type SourceInput = {
  readonly values: ReadonlyArray<number>;
  readonly width?: number;
  readonly height?: number;
  readonly physicalWidthMm?: number;
  readonly physicalHeightMm?: number;
  readonly maxDepthMm?: number;
  readonly mask?: ReadonlyArray<number>;
  readonly mapping?: Partial<ReliefHeightfieldMapping>;
};

export function source(input: SourceInput): ReliefHeightfield {
  const width = input.width ?? input.values.length;
  const height = input.height ?? 1;
  const physicalWidthMm = input.physicalWidthMm ?? width;
  const physicalHeightMm = input.physicalHeightMm ?? height;
  const maxDepthMm = input.maxDepthMm ?? 5;
  return createReliefHeightfield({
    width,
    height,
    physicalWidthMm,
    physicalHeightMm,
    samples: u16ValuesToLittleEndian(input.values),
    ...(input.mask === undefined ? {} : { inclusionMask: Uint8Array.from(input.mask) }),
    mapping: {
      polarity: 'light-is-high',
      inputLowCode: 0,
      inputHighCode: 0xffff,
      curve: { kind: 'gamma-v1', gamma: 1 },
      maxDepthMm,
      crop: { kind: 'normalized-v1', x: 0, y: 0, width: 1, height: 1 },
      aspect: 'preserve',
      inclusionThreshold: 255,
      outsideMask: 'excluded',
      ...input.mapping,
    },
    provenance: {
      sourceKind: 'depth-map',
      sourceName: 'test.png',
      sourceBitDepth: 16,
      sourcePolarity: input.mapping?.polarity ?? 'light-is-high',
    },
  });
}

export function materialize(field: ReliefHeightfield, mmPerCell = 1) {
  return heightfieldToHeightmap(field, {
    targetWidthMm: field.physicalWidthMm,
    reliefDepthMm: field.mapping.maxDepthMm,
    mmPerCell,
  });
}
