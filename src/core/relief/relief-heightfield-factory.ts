import type {
  ReliefHeightfield,
  ReliefHeightfieldMapping,
  ReliefHeightfieldProvenance,
} from '../scene/relief';
import { encodeCanonicalBase64 } from './depth-map-base64';
import { reliefHeightfieldDigest } from './heightfield-digest';

export type CreateReliefHeightfieldInput = {
  readonly width: number;
  readonly height: number;
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
  /** Exact row-major U16 little-endian scalar bytes. */
  readonly samples: Uint8Array;
  readonly inclusionMask?: Uint8Array;
  readonly mapping: ReliefHeightfieldMapping;
  readonly provenance: ReliefHeightfieldProvenance;
  readonly revision?: number;
};

/** Construct one self-contained canonical field and bind its exact byte digest. */
export function createReliefHeightfield(input: CreateReliefHeightfieldInput): ReliefHeightfield {
  return {
    kind: 'heightfield-v1',
    schemaVersion: 1,
    width: input.width,
    height: input.height,
    physicalWidthMm: input.physicalWidthMm,
    physicalHeightMm: input.physicalHeightMm,
    encoding: 'u16le-base64-v1',
    samplesBase64: encodeCanonicalBase64(input.samples),
    ...(input.inclusionMask === undefined
      ? {}
      : {
          inclusionMask: {
            encoding: 'u8-base64-v1' as const,
            samplesBase64: encodeCanonicalBase64(input.inclusionMask),
          },
        }),
    mapping: input.mapping,
    provenance: input.provenance,
    algorithmRevision: 'heightfield-map-v1',
    revision: input.revision ?? 0,
    digest: reliefHeightfieldDigest({
      width: input.width,
      height: input.height,
      samples: input.samples,
      ...(input.inclusionMask === undefined
        ? {}
        : {
            inclusionMask: {
              encoding: 'u8-base64-v1' as const,
              samples: input.inclusionMask,
            },
          }),
    }),
  };
}

/** Encode numeric U16 values explicitly as little-endian bytes. */
export function u16ValuesToLittleEndian(values: ReadonlyArray<number>): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    bytes[index * 2] = value & 0xff;
    bytes[index * 2 + 1] = value >>> 8;
  }
  return bytes;
}
