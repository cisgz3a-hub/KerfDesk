import { describe, expect, it } from 'vitest';
import { fingerprintGcode } from '../../../core/recovery';
import { isLaserSecondPassChain, laserSecondPassChainsEqual } from './laser-second-pass-lineage';

const stage = {
  sourceRunId: 'run-source',
  sourceFingerprint: fingerprintGcode('G21\nM5\n'),
  resumeChainBefore: [],
  selection: {
    version: 1 as const,
    maxPowerS: 1000,
    strokes: [
      { id: 'spot', mode: 'paint' as const, radiusMm: 1, powerScale: 1, points: [{ x: 1, y: 2 }] },
    ],
  },
};

describe('saved painted writer versions', () => {
  it.each([undefined, 1, 2, 3])('accepts writer %s without rewriting it', (writerVersion) => {
    const value = [{ ...stage, ...(writerVersion === undefined ? {} : { writerVersion }) }];
    expect(isLaserSecondPassChain(value)).toBe(true);
  });

  it.each([0, 4, -1, 1.5, '3', null, Number.NaN])(
    'refuses an unknown writer %s',
    (writerVersion) => {
      expect(isLaserSecondPassChain([{ ...stage, writerVersion }])).toBe(false);
    },
  );

  it('keeps an unversioned stage equivalent only to writer 1', () => {
    expect(laserSecondPassChainsEqual([stage], [{ ...stage, writerVersion: 1 }])).toBe(true);
    expect(laserSecondPassChainsEqual([stage], [{ ...stage, writerVersion: 3 }])).toBe(false);
    expect(
      laserSecondPassChainsEqual(
        [{ ...stage, writerVersion: 2 }],
        [{ ...stage, writerVersion: 3 }],
      ),
    ).toBe(false);
  });
});
