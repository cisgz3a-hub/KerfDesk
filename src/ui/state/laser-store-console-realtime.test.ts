// Controller audit 2026-09-25 GP-3 and GP-4 through the store. GRBL holds on a
// `!` anywhere in the byte stream and then answers nothing until `~`, so the
// Console must never queue one inside a line; a lone `~` must reach a held
// controller. GRBL leaves Check mode only on a second `$C` (system.c:147-157).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import { connectWith, flushConnect, makeConnection } from './laser-store-console.test-support';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

async function connectedWrites(): Promise<{
  readonly writes: string[];
  readonly emit: (line: string) => void;
}> {
  const writes: string[] = [];
  const connection = makeConnection(async (data) => {
    writes.push(data);
  });
  await connectWith(connection);
  writes.length = 0;
  return { writes, emit: connection.emitLine };
}

describe('Console realtime characters (GP-3)', () => {
  it('refuses a line that carries a feed hold and writes nothing', async () => {
    const { writes } = await connectedWrites();
    await expect(useLaserStore.getState().sendConsoleCommand('M8 (air on!)')).rejects.toThrow(
      /feed-hold/,
    );
    expect(writes).toEqual([]);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('sends a lone ~ to a held controller as one realtime byte', async () => {
    const { writes, emit } = await connectedWrites();
    emit('<Hold:0|MPos:0.000,0.000,0.000|FS:0,0>');
    await flushConnect();
    await useLaserStore.getState().sendConsoleCommand('~');
    expect(writes).toEqual(['~']);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });
});

describe('Console check mode (GP-4)', () => {
  it('sends the second $C that takes GRBL out of Check mode', async () => {
    const { writes, emit } = await connectedWrites();
    emit('<Check|MPos:0.000,0.000,0.000|FS:0,0>');
    await flushConnect();
    await useLaserStore.getState().sendConsoleCommand('$C');
    expect(writes).toEqual(['$C\n']);
  });

  it('still refuses $C while the controller is running', async () => {
    const { writes, emit } = await connectedWrites();
    emit('<Run|MPos:0.000,0.000,0.000|FS:100,0>');
    await flushConnect();
    await expect(useLaserStore.getState().sendConsoleCommand('$C')).rejects.toThrow(
      /only in Idle or Check/,
    );
    expect(writes).toEqual([]);
  });
});
