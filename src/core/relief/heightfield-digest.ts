import type { ReliefHeightfieldMask } from '../scene/relief';
import { sha256Hex } from './sha256';

const DOMAIN = new TextEncoder().encode('CurveDesk\0heightfield-v1\0');
const MASK_SEPARATOR = Uint8Array.of(0xff, 0x4d, 0x41, 0x53, 0x4b, 0x00);

export type ReliefHeightfieldDigestInput = {
  readonly width: number;
  readonly height: number;
  readonly samples: Uint8Array;
  readonly inclusionMask?: {
    readonly encoding: ReliefHeightfieldMask['encoding'];
    readonly samples: Uint8Array;
  };
};

/** Digest exact scalar/mask bytes plus the dimensions and named encodings. */
export function reliefHeightfieldDigest(input: ReliefHeightfieldDigestInput): `sha256:${string}` {
  const maskLength = input.inclusionMask?.samples.byteLength ?? -1;
  const header = new TextEncoder().encode(
    `${input.width}\0${input.height}\0u16le-base64-v1\0${input.samples.byteLength}\0` +
      `${input.inclusionMask?.encoding ?? 'none'}\0${maskLength}\0`,
  );
  const parts = [DOMAIN, header, input.samples, MASK_SEPARATOR];
  if (input.inclusionMask !== undefined) parts.push(input.inclusionMask.samples);
  return `sha256:${sha256Hex(parts)}`;
}
