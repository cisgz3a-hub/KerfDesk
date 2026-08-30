import { describe, expect, it } from 'vitest';
import { createNativeSmokeTerminalClaim } from './native-smoke-terminal-claim.js';

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe('packaged native-smoke terminal claim', () => {
  it('keeps a timeout as sole owner when the renderer resolves later', async () => {
    const claimTerminal = createNativeSmokeTerminalClaim();
    const renderer = deferred<unknown>();
    const finalizations: string[] = [];
    const lateRenderer = renderer.promise.then(() => {
      if (claimTerminal()) finalizations.push('renderer success');
    });

    if (claimTerminal()) finalizations.push('timeout');
    renderer.resolve({ readyToShow: true });
    await lateRenderer;

    expect(finalizations).toEqual(['timeout']);
    expect(claimTerminal()).toBe(false);
  });
});
