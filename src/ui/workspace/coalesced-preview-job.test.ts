import { describe, expect, it, vi } from 'vitest';
import { createCoalescedJob, type CoalescedOutcome } from './coalesced-preview-job';

type Deferred = {
  readonly input: number;
  readonly signal: AbortSignal;
  readonly resolve: (value: string) => void;
  readonly reject: (error: unknown) => void;
};

function harness(isSuperseded: (error: unknown) => boolean = () => false) {
  const runs: Deferred[] = [];
  const settled: Array<[number, CoalescedOutcome<string>]> = [];
  const job = createCoalescedJob<number, string>(
    (input, signal) =>
      new Promise<string>((resolve, reject) => {
        runs.push({ input, signal, resolve, reject });
      }),
    (input, outcome) => settled.push([input, outcome]),
    isSuperseded,
  );
  return { job, runs, settled };
}

describe('createCoalescedJob', () => {
  it('lets the running job finish while the input moves, then runs only the newest', async () => {
    const { job, runs, settled } = harness();
    job.request(1);
    job.request(2);
    job.request(3);
    expect(runs.map((run) => run.input)).toEqual([1]);
    expect(runs[0]?.signal.aborted).toBe(false);

    runs[0]?.resolve('one');
    await vi.waitFor(() => expect(runs).toHaveLength(2));
    expect(settled).toEqual([[1, { kind: 'done', value: 'one' }]]);
    expect(runs[1]?.input).toBe(3);

    runs[1]?.resolve('three');
    await vi.waitFor(() => expect(settled).toHaveLength(2));
    expect(settled[1]).toEqual([3, { kind: 'done', value: 'three' }]);
    expect(runs).toHaveLength(2);
  });

  it('drops a waiting input that returns to the one already running', async () => {
    const { job, runs, settled } = harness();
    job.request(1);
    job.request(2);
    job.request(1);
    runs[0]?.resolve('one');
    await vi.waitFor(() => expect(settled).toHaveLength(1));
    expect(runs).toHaveLength(1);
  });

  it('aborts the running job on cancel and ignores its late result', async () => {
    const { job, runs, settled } = harness();
    job.request(1);
    job.request(2);
    job.cancel();
    expect(runs[0]?.signal.aborted).toBe(true);
    runs[0]?.resolve('late');
    await Promise.resolve();
    expect(settled).toEqual([]);
    expect(runs).toHaveLength(1);

    job.request(4);
    expect(runs.map((run) => run.input)).toEqual([1, 4]);
  });

  it('settles failures and unavailable work, and skips superseded results', async () => {
    const superseded = new Error('superseded');
    const { job, runs, settled } = harness((error) => error === superseded);
    job.request(1);
    job.request(2);
    runs[0]?.reject(superseded);
    await vi.waitFor(() => expect(runs).toHaveLength(2));
    const failure = new Error('worker stopped');
    runs[1]?.reject(failure);
    await vi.waitFor(() => expect(settled).toHaveLength(1));
    expect(settled).toEqual([[2, { kind: 'failed', error: failure }]]);

    const unavailable: Array<CoalescedOutcome<string>> = [];
    const offline = createCoalescedJob<number, string>(
      () => null,
      (_input, outcome) => unavailable.push(outcome),
      () => false,
    );
    offline.request(1);
    expect(unavailable).toEqual([{ kind: 'unavailable' }]);
  });
});
