import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRendererProblems,
  recentRendererProblems,
  recordRendererProblem,
  watchRendererProblems,
} from './renderer-problems';

afterEach(() => clearRendererProblems());

describe('renderer problems', () => {
  it('keeps the newest fifty, oldest first', () => {
    for (let index = 0; index < 55; index += 1)
      recordRendererProblem('error', `Problem ${index}`, index);
    const kept = recentRendererProblems();
    expect(kept).toHaveLength(50);
    expect(kept[0]).toEqual({ at: 5, kind: 'error', message: 'Problem 5' });
    expect(kept.at(-1)?.message).toBe('Problem 54');
  });

  it('names an error even when its stack leaves the message out', () => {
    const error = new TypeError('layer is undefined');
    error.stack = 'draw@app://app/assets/index.js:1:2';
    recordRendererProblem('crash', error, 1);
    expect(recentRendererProblems()[0]?.message).toBe(
      'TypeError: layer is undefined\ndraw@app://app/assets/index.js:1:2',
    );
  });

  it('shortens a very long problem', () => {
    recordRendererProblem('error', 'z'.repeat(5000), 1);
    expect(recentRendererProblems()[0]?.message).toHaveLength(2001);
  });

  it('records uncaught errors and unhandled rejections until stopped', () => {
    const target = new EventTarget() as unknown as Window;
    const stop = watchRendererProblems(target);
    target.dispatchEvent(
      Object.assign(new Event('error'), { error: new RangeError('bad zoom'), message: 'x' }),
    );
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'port closed' }));
    stop();
    target.dispatchEvent(Object.assign(new Event('error'), { error: null, message: 'ignored' }));

    expect(
      recentRendererProblems().map(({ kind, message }) => [kind, message.split('\n')[0]]),
    ).toEqual([
      ['error', 'RangeError: bad zoom'],
      ['unhandled rejection', 'port closed'],
    ]);
  });
});
