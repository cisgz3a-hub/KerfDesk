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
  it('pops exactly the comparator order under interleaved pushes', () => {
    let seed = 3;
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * n);
    };
    for (let round = 0; round < 20; round += 1) {
      const distSq = Float64Array.from({ length: 300 }, () => random(6));
      const queue = bucketErosionQueue(distSq);
      expect(queue).not.toBeNull();
      const pending: number[] = [];
      for (let index = 0; index < 300; index += 1) {
        const entry = index * 16 + random(9);
        queue?.push(entry);
        pending.push(entry);
      }
      let requeues = 1500;
      while (pending.length > 0) {
        expect(queue?.size()).toBe(pending.length);
        expect(queue?.pop()).toBe(takeLeast(pending, distSq));
        // Requeue a few neighbours, some into the key being drained.
        for (let k = random(4); k > 0 && requeues > 0; k -= 1, requeues -= 1) {
          const entry = random(300) * 16 + random(9);
          queue?.push(entry);
          pending.push(entry);
        }
      }
      expect(queue?.size()).toBe(0);
    }
  });

  it('declines a field with non-integer distances', () => {
    expect(bucketErosionQueue(Float64Array.from([0, 1.5, 4]))).toBeNull();
    expect(bucketErosionQueue(Float64Array.from([0, Number.NaN]))).toBeNull();
  });
});
