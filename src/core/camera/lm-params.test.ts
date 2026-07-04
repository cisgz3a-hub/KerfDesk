import { describe, expect, it } from 'vitest';
import type { CameraIntrinsics, FisheyeDistortion } from './fisheye';
import {
  GLOBAL_PARAM_COUNT,
  packParams,
  PER_VIEW_PARAM_COUNT,
  rvecOffset,
  tvecOffset,
  unpackParams,
  type ViewExtrinsic,
} from './lm-params';

const K: CameraIntrinsics = { fx: 900, fy: 890, cx: 955, cy: 545 };
const D: FisheyeDistortion = [0.08, -0.01, 0.004, -0.0005];
const VIEWS: ViewExtrinsic[] = [
  { rvec: [0.1, -0.2, 0.05], tvec: [3, -4, 600] },
  { rvec: [0.45, 0, 0], tvec: [0, 10, 620] },
];

describe('lm-params offsets', () => {
  it('computes rvec/tvec offsets from the layout', () => {
    expect(rvecOffset(0)).toBe(8);
    expect(tvecOffset(0)).toBe(11);
    expect(rvecOffset(2)).toBe(20);
    expect(tvecOffset(2)).toBe(23);
  });
});

describe('packParams / unpackParams', () => {
  it('produces a vector of the expected length', () => {
    const params = packParams(K, D, VIEWS);
    expect(params).toHaveLength(GLOBAL_PARAM_COUNT + PER_VIEW_PARAM_COUNT * VIEWS.length);
  });

  it('round-trips intrinsics, distortion, and views exactly', () => {
    const result = unpackParams(packParams(K, D, VIEWS), VIEWS.length);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.intrinsics).toEqual(K);
    expect(result.distortion).toEqual(D);
    expect(result.views).toEqual(VIEWS);
  });

  it('round-trips the zero-view case', () => {
    const result = unpackParams(packParams(K, D, []), 0);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.views).toEqual([]);
  });

  it('fails when the vector length does not match numViews', () => {
    const params = packParams(K, D, VIEWS);
    expect(unpackParams(params, VIEWS.length + 1)).toEqual({
      kind: 'failed',
      reason: 'bad-length',
    });
    expect(unpackParams(params.slice(0, -1), VIEWS.length)).toEqual({
      kind: 'failed',
      reason: 'bad-length',
    });
  });

  it('fails on a negative view count', () => {
    expect(unpackParams([], -1)).toEqual({ kind: 'failed', reason: 'bad-length' });
  });
});
