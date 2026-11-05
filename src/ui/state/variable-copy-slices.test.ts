import { describe, expect, it, vi } from 'vitest';
import { fixtureState, GRID, NOW, renderFixture } from './variable-array-test-fixture';
import { prepareVariableArray } from './prepare-variable-array';
import { variableCopySlices } from './variable-copy-slices';

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Performance audit S7-P2-1: every copy rendered in one task, so the window froze and a
// Cancel click was handled only after the last copy was made.
describe('variable copies render in slices', () => {
  it('reports progress for every copy', async () => {
    const progress: string[] = [];
    const result = await prepareVariableArray(fixtureState(), GRID, {
      render: renderFixture,
      clock: () => NOW,
      yieldNow: async () => undefined,
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    });
    expect(result.ok).toBe(true);
    expect(progress).toEqual(['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']);
  });

  it('lets a Cancel queued as a task stop the batch before any copy is placed', async () => {
    const all = vi.fn(renderFixture);
    await prepareVariableArray(fixtureState(), GRID, { render: all, clock: () => NOW });
    const perCopy = all.mock.calls.length / 6;
    let cancelled = false;
    setTimeout(() => {
      cancelled = true;
    }, 0);
    const render = vi.fn(renderFixture);
    const result = await prepareVariableArray(fixtureState(), GRID, {
      render,
      clock: () => NOW,
      isCurrent: () => !cancelled,
      // A spent slice on every copy: each yield is a real macrotask.
      yieldNow: variableCopySlices(() => 0, 0, macrotask),
    });
    expect(result).toMatchObject({ ok: false, cancelled: true });
    // The first copy renders before the event loop gets its turn; nothing after it.
    expect(perCopy).toBeGreaterThan(0);
    expect(render).toHaveBeenCalledTimes(perCopy);
  });

  it('without a yield the batch is one task, which is what froze the window', async () => {
    let cancelled = false;
    setTimeout(() => {
      cancelled = true;
    }, 0);
    const result = await prepareVariableArray(fixtureState(), GRID, {
      render: renderFixture,
      clock: () => NOW,
      isCurrent: () => !cancelled,
    });
    expect(result.ok).toBe(true);
  });

  it('yields only once the slice is spent', async () => {
    let clock = 0;
    const nextTask = vi.fn(async () => undefined);
    const slices = variableCopySlices(() => clock, 50, nextTask);
    clock = 49;
    await slices();
    expect(nextTask).not.toHaveBeenCalled();
    clock = 50;
    await slices();
    expect(nextTask).toHaveBeenCalledOnce();
    clock = 99;
    await slices();
    expect(nextTask).toHaveBeenCalledOnce();
    clock = 100;
    await slices();
    expect(nextTask).toHaveBeenCalledTimes(2);
  });
});
