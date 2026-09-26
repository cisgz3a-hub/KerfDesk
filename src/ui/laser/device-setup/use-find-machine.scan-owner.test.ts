// A scan's connection stops being the scan's once a connect it did not start
// begins, such as auto-connect after a replug, so the scan then closes nothing
// (2026-09-26 review of #941).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { scanConnectionOwnership } from './use-find-machine';

const original = useLaserStore.getState();

beforeEach(() => {
  useLaserStore.setState(initialLaserState());
});

afterEach(() => {
  useLaserStore.setState(original, true);
});

describe('baud scan connection ownership', () => {
  it("keeps the scan's own connect and flags anyone else's", async () => {
    const owner = scanConnectionOwnership();
    try {
      await owner.open(async () => {
        useLaserStore.setState({ connection: { kind: 'connecting' } });
        useLaserStore.setState({ connection: { kind: 'connected' } });
      });
      expect(owner.replaced()).toBe(false);
      useLaserStore.setState({ connection: { kind: 'connecting' } });
      expect(owner.replaced()).toBe(true);
    } finally {
      owner.release();
    }
  });

  it('stops listening once released', () => {
    const owner = scanConnectionOwnership();
    owner.release();
    useLaserStore.setState({ connection: { kind: 'connecting' } });
    expect(owner.replaced()).toBe(false);
  });
});
