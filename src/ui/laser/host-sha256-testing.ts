// Host SHA-256 on the simulated clock, for suites that drive a Start and its
// recovery archive under fake timers: the recovery stress harness and the
// archive activation fallback tests.

import { createHash } from 'node:crypto';
import { vi } from 'vitest';

let heldDigests: Promise<void> | null = null;

/** WebCrypto resolves `crypto.subtle.digest` on a real event-loop turn, and
 * advancing fake time grants the real loop one turn per fired timer. A Start's
 * archive hashes in three sequential rounds before it activates, so on a
 * loaded runner the simulated machine would stream on while it hashed, and a
 * seeded restart could land before activation and find only the pending Start
 * (ADR-337). A run's settlement hashes too, so an assertion made after
 * advancing fake time could run before the run settled. The same SHA-256
 * bytes, resolved on the microtask queue, finish before the next simulated
 * acknowledgement, as hashing a job this size does on real hardware. Call it
 * from `beforeEach`: each call starts unheld, and `vi.restoreAllMocks()`
 * removes it. */
export function hashOnSimulatedClock(): void {
  heldDigests = null;
  const subtle = globalThis.crypto.subtle;
  const webCryptoDigest = subtle.digest.bind(subtle);
  vi.spyOn(subtle, 'digest').mockImplementation(async (algorithm, data) => {
    if (!isSha256(algorithm)) return webCryptoDigest(algorithm, data);
    if (heldDigests !== null) await heldDigests;
    return sha256(data);
  });
}

/** Hold every host SHA-256 until the returned release runs, so an accepted
 * Start's execution archive cannot activate (ADR-337's pre-activation window).
 * A hold its test never releases stays pending: those flows stop for good
 * rather than resume into the next test, whose beforeEach starts unheld. A
 * late release from a timed-out test leaves a newer test's hold in place. */
export function holdHostDigests(): () => void {
  let release = (): void => undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  heldDigests = hold;
  return () => {
    if (heldDigests === hold) heldDigests = null;
    release();
  };
}

function isSha256(algorithm: AlgorithmIdentifier): boolean {
  const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
  return name.toUpperCase() === 'SHA-256';
}

function sha256(data: BufferSource): ArrayBuffer {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  return new Uint8Array(createHash('sha256').update(bytes).digest()).buffer;
}
