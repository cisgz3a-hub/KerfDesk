import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import type { LargeJobPreparation } from './large-job-preparation';
import { PreparationResultCache } from './preparation-result-cache';

const prepared: LargeJobPreparation = {
  estimate: { kind: 'empty' },
  toolpath: {
    totalLength: 5,
    steps: [{ kind: 'travel', from: { x: 0, y: 0 }, to: { x: 3, y: 4 }, length: 5 }],
  },
};

function deferred() {
  let resolve: (result: LargeJobPreparation) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<LargeJobPreparation>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('full Preview cache lifetime', () => {
  it('releases a completed route globally before its replacement settles', async () => {
    const cache = new PreparationResultCache(4);
    const firstProject = createProject();
    const secondProject = createProject();
    const first = Promise.resolve(prepared);
    cache.set(firstProject, 'first', { projection: 'preview', promise: first });
    await first;
    expect(cache.get(firstProject, 'first')?.promise).toBe(first);

    const next = deferred();
    cache.set(secondProject, 'second', { projection: 'preview', promise: next.promise });
    expect(cache.get(firstProject, 'first')).toBeUndefined();
    expect(cache.get(secondProject, 'second')?.promise).toBe(next.promise);
    // Eviction removes reuse, not the geometry already delivered to a consumer.
    await expect(first).resolves.toBe(prepared);
    expect(prepared.toolpath.steps).toHaveLength(1);
    next.resolve(prepared);
    await next.promise;
    expect(cache.get(secondProject, 'second')?.promise).toBe(next.promise);
  });

  it.each([true, false])(
    'delivers an earlier full result without retaining it again (earlier finishes first: %s)',
    async (earlierFirst) => {
      const cache = new PreparationResultCache(4);
      const project = createProject();
      const earlier = deferred();
      const latest = deferred();
      cache.set(project, 'earlier', { projection: 'preview', promise: earlier.promise });
      cache.set(project, 'latest', { projection: 'preview', promise: latest.promise });
      for (const request of earlierFirst ? [earlier, latest] : [latest, earlier]) {
        request.resolve(prepared);
        await expect(request.promise).resolves.toBe(prepared);
      }
      expect(cache.get(project, 'earlier')).toBeUndefined();
      expect(cache.get(project, 'latest')?.promise).toBe(latest.promise);
    },
  );

  it('does not restore the earlier full route when the newer request fails', async () => {
    const cache = new PreparationResultCache(4);
    const project = createProject();
    const earlier = deferred();
    const latest = deferred();
    cache.set(project, 'earlier', { projection: 'preview', promise: earlier.promise });
    cache.set(project, 'latest', { projection: 'preview', promise: latest.promise });
    latest.reject(new Error('replacement failed'));
    await expect(latest.promise).rejects.toThrow('replacement failed');
    earlier.resolve(prepared);
    await expect(earlier.promise).resolves.toBe(prepared);
    expect(cache.get(project, 'earlier')).toBeUndefined();
    expect(cache.get(project, 'latest')).toBeUndefined();
  });

  it('keeps the combined settled bound and never restores an evicted full result', async () => {
    const cache = new PreparationResultCache(3);
    const project = createProject();
    const full = Promise.resolve(prepared);
    cache.set(project, 'full', { projection: 'preview', promise: full });
    await full;
    const estimates = ['a', 'b', 'c'].map(() => Promise.resolve({ estimate: prepared.estimate }));
    for (const [index, promise] of estimates.entries()) {
      cache.set(project, String(index), { projection: 'estimate', promise });
      await promise;
    }
    expect(cache.get(project, 'full')).toBeUndefined();
    expect(cache.get(project, '0')?.promise).toBe(estimates[0]);
    const extra = Promise.resolve({ estimate: prepared.estimate });
    cache.set(project, 'extra', { projection: 'estimate', promise: extra });
    await extra;
    expect(cache.get(project, '1')).toBeUndefined();
    expect(cache.get(project, '0')?.promise).toBe(estimates[0]);
    expect(cache.get(project, 'full')).toBeUndefined();
  });
});
