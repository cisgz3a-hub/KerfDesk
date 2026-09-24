// The stress harness moves one platform service onto the simulated clock: host
// SHA-256. It must still return WebCrypto's bytes, and settle without a real
// event-loop turn, or the stress suites would prove timing they never ran.

import { describe, expect, it, vi } from 'vitest';
import { installRecoveryStressHooks } from './recovery-stress-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

// The prototype method stays WebCrypto's own; the harness spies the instance.
const webCryptoDigest = (Object.getPrototypeOf(crypto.subtle) as SubtleCrypto).digest;

describe('host SHA-256 on the simulated clock', () => {
  it('returns the bytes WebCrypto returns for every buffer shape and algorithm spelling', async () => {
    const text = new TextEncoder().encode('KerfDesk archived controller observation v1\0G1 X1');
    const inputs: BufferSource[] = [
      new Uint8Array(0),
      text,
      text.subarray(3, 17),
      text.buffer.slice(0),
      new DataView(text.buffer, 5, 9),
    ];
    for (const input of inputs) {
      const expected = new Uint8Array(await webCryptoDigest.call(crypto.subtle, 'SHA-256', input));
      for (const algorithm of ['SHA-256', 'sha-256', { name: 'SHA-256' }]) {
        const shimmed = new Uint8Array(await crypto.subtle.digest(algorithm, input));
        expect(shimmed).toEqual(expected);
      }
    }
  });

  it('settles on the microtask queue, before any fake timer can fire', async () => {
    let settled = false;
    void crypto.subtle.digest('SHA-256', new Uint8Array([1, 2, 3])).then(() => {
      settled = true;
    });
    for (let turn = 0; turn < 5 && !settled; turn += 1) await Promise.resolve();
    expect(settled).toBe(true);
  });
});
