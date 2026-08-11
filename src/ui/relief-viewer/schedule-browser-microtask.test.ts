import { afterEach, expect, it, vi } from 'vitest';
import { scheduleBrowserMicrotask } from './schedule-browser-microtask';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('calls the browser scheduler without an object receiver', () => {
  const callback = vi.fn();
  const scheduler = vi.fn(function (this: unknown, scheduled: () => void) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    scheduled();
  });
  vi.stubGlobal('queueMicrotask', scheduler);

  expect(() => scheduleBrowserMicrotask(callback)).not.toThrow();
  expect(scheduler).toHaveBeenCalledOnce();
  expect(callback).toHaveBeenCalledOnce();
});
