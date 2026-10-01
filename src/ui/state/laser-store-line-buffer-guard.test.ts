// Controller audit S-3: Start compared each line only with the RX window, so a
// line inside the window but past stock GRBL's 79-character line buffer
// (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.h#L31-L32)
// started the job, which then stopped on the controller's error:11
// (protocol.c#L90-L92). On the real store, Start now refuses it first.

import { afterEach, describe, expect, it } from 'vitest';
import { useLaserStore } from './laser-store';
import { connectWith, makeConnection } from './laser-store-console.test-support';
import { startTestLaserJob } from './laser-test-start-helpers';

afterEach(async () => {
  await useLaserStore.getState().disconnect();
});

describe('startJob GRBL line-buffer guard', () => {
  it('refuses a line that fits the RX window but not the line buffer, sending nothing', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const overLineBuffer = `G1 X${'9'.repeat(77)}`;
    // 82 bytes on the wire: well inside stock GRBL's 120-byte window.
    expect(`${overLineBuffer}\n`.length).toBeLessThan(120);
    await expect(startTestLaserJob(`G21\n${overLineBuffer}\n`)).rejects.toThrow(
      /G-code line 2 has 80 significant characters.*error:11/,
    );

    expect(useLaserStore.getState().streamer).toBeNull();
    expect(writes).toEqual([]);
  });

  it('still starts a line padded past 79 bytes with spaces and a comment', async () => {
    const writes: string[] = [];
    const connection = makeConnection(
      async (data) => {
        writes.push(data);
      },
      { autoAckStartFence: true },
    );
    await connectWith(connection);
    writes.length = 0;

    const padded = `G1 X1.000 Y1.000 F1000 S0 ${' '.repeat(40)}; ${'c'.repeat(20)}`;
    expect(padded.length).toBeGreaterThan(79);
    await startTestLaserJob(`G21\n${padded}\n`);

    expect(writes.join('')).toContain(padded);
  });
});
