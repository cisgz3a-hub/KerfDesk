import { describe, expect, it } from 'vitest';
import { createLastScopeProjectionCache } from './frame-spatial-projection-cache';

describe('Frame projection cache lifetime', () => {
  it('retains only the latest of 400 scopes on one history-held source', () => {
    const cache = createLastScopeProjectionCache<object, object>();
    const historySource = {};
    const projections = Array.from({ length: 400 }, () => ({}));
    for (const [index, projection] of projections.entries()) {
      cache.set(historySource, String(index), projection);
      expect(cache.get(historySource, String(index))).toBe(projection);
    }
    for (let index = 0; index < projections.length - 1; index += 1) {
      expect(cache.get(historySource, String(index))).toBeUndefined();
    }
    expect(cache.get(historySource, '399')).toBe(projections[399]);
  });

  it('keeps independent source identities and misses after switching back to an older scope', () => {
    const cache = createLastScopeProjectionCache<object, object>();
    const first = {},
      second = {},
      oldProjection = {},
      newProjection = {},
      otherProjection = {};
    cache.set(first, 'A', oldProjection);
    cache.set(second, 'A', otherProjection);
    cache.set(first, 'B', newProjection);
    expect(cache.get(first, 'A')).toBeUndefined();
    expect(cache.get(first, 'B')).toBe(newProjection);
    expect(cache.get(second, 'A')).toBe(otherProjection);
    cache.set(first, 'A', oldProjection);
    expect(cache.get(first, 'B')).toBeUndefined();
    expect(cache.get(first, 'A')).toBe(oldProjection);
  });
});
