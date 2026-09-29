import { describe, expect, it } from 'vitest';
import { bucketErosionQueue } from './erosion-queue';

// Reference: the pending entry with the least (distance, tie, index).
function takeLeast(pending: number[], distSq: Float64Array): number {
  let best = 0;
  const key = (entry: number): [number, number, number] => {
    const index = Math.floor(entry / 16);
    return [distSq[index] as number, entry - index * 16, index];
  };
  for (let k = 1; k < pending.length; k += 1) {
    const [d, t, i] = key(pending[k] as number);
    const [bd, bt, bi] = key(pending[best] as number);
    if (d < bd || (d === bd && (t < bt || (t === bt && i < bi)))) best = k;
  }
  return pending.splice(best, 1)[0] as number;
}

describe('bucket erosion queue', () => {
  // Pushes random entries, some into the key being drained and some exact
  // duplicates of pending entries (those are dropped: one pending copy each).
  function checkAgainstComparator(
    distSq: Float64Array,
    random: (n: number) => number,
    pendingMask?: Uint16Array,
  ): void {
    const count = distSq.length;
    const queue = bucketErosionQueue(distSq, undefined, pendingMask);
    expect(queue).not.toBeNull();
    const pending: number[] = [];
    const push = (entry: number): void => {
      queue?.push(entry);
      if (!pending.includes(entry)) pending.push(entry);
    };
    for (let index = 0; index < count; index += 1) push(index * 16 + random(9));
    let requeues = count * 5;
    while (pending.length > 0) {
      expect(queue?.size()).toBe(pending.length);
      expect(queue?.pop()).toBe(takeLeast(pending, distSq));
      for (let k = random(4); k > 0 && requeues > 0; k -= 1, requeues -= 1) {
        push(random(count) * 16 + random(9));
      }
    }
    expect(queue?.size()).toBe(0);
  }

  function lcg(seed: number): (n: number) => number {
    let state = seed;
    return (n) => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return Math.floor((state / 2147483648) * n);
    };
  }

  it('pops exactly the comparator order under interleaved pushes', () => {
    const random = lcg(3);
    for (let round = 0; round < 20; round += 1) {
      checkAgainstComparator(
        Float64Array.from({ length: 300 }, () => random(6)),
        random,
      );
    }
  });

  it('leaves a shared pending mask all zero once drained, so queues run in turn may share it', () => {
    const random = lcg(11);
    const distSq = Float64Array.from({ length: 300 }, () => random(6));
    const shared = new Uint16Array(distSq.length);
    for (let round = 0; round < 3; round += 1) {
      checkAgainstComparator(distSq, random, shared);
      expect(shared.every((bits) => bits === 0)).toBe(true);
    }
  });

  it('keeps one pending copy of an exact duplicate, and accepts it again once popped', () => {
    const queue = bucketErosionQueue(Float64Array.from([4, 1]));
    queue?.push(0 * 16 + 2);
    queue?.push(0 * 16 + 2);
    queue?.push(0 * 16 + 3);
    expect(queue?.size()).toBe(2);
    expect(queue?.pop()).toBe(2);
    queue?.push(0 * 16 + 2);
    expect(queue?.size()).toBe(2);
    expect(queue?.pop()).toBe(2);
    expect(queue?.pop()).toBe(3);
    expect(queue?.size()).toBe(0);
  });

  it('orders distances beyond the dense rank table by binary search', () => {
    const random = lcg(5);
    for (let round = 0; round < 10; round += 1) {
      checkAgainstComparator(
        Float64Array.from({ length: 200 }, () => random(6) * 2 ** 24 + random(3)),
        random,
      );
    }
  });

  it('declines a field with non-integer distances', () => {
    expect(bucketErosionQueue(Float64Array.from([0, 1.5, 4]))).toBeNull();
    expect(bucketErosionQueue(Float64Array.from([0, Number.NaN]))).toBeNull();
  });
});
