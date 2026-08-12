import { describe, expect, it } from 'vitest';
import { reliefHeightfieldDigest } from './heightfield-digest';

describe('reliefHeightfieldDigest', () => {
  it('matches hard-coded persisted-preimage goldens with and without a mask', () => {
    const source = { width: 2, height: 1, samples: Uint8Array.of(0, 0, 255, 255) };

    expect(reliefHeightfieldDigest(source)).toBe(
      'sha256:0bb01606935a260e822852dc9559c68436a61693c701f566cfab4790e3c1b656',
    );
    expect(
      reliefHeightfieldDigest({
        ...source,
        inclusionMask: { encoding: 'u8-base64-v1', samples: Uint8Array.of(0, 255) },
      }),
    ).toBe('sha256:3bcc4d3f75c7f7f45007f9e84920e13819350db49c2f8402635b1cf28bd67151');
  });

  it('is deterministic and binds dimensions, scalar bytes, mask presence, and mask bytes', () => {
    const source = { width: 2, height: 1, samples: Uint8Array.of(0, 0, 255, 255) };
    const digest = reliefHeightfieldDigest(source);

    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(reliefHeightfieldDigest(source)).toBe(digest);
    expect(reliefHeightfieldDigest({ ...source, width: 1, height: 2 })).not.toBe(digest);
    expect(reliefHeightfieldDigest({ ...source, samples: Uint8Array.of(0, 0, 254, 255) })).not.toBe(
      digest,
    );
    expect(
      reliefHeightfieldDigest({
        ...source,
        inclusionMask: { encoding: 'u8-base64-v1', samples: Uint8Array.of(255, 255) },
      }),
    ).not.toBe(digest);
  });
});
