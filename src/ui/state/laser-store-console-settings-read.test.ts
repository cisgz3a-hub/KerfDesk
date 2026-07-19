import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectWith, flushConnect, makeConnection } from './laser-store-console-harness';
import { useLaserStore } from './laser-store';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    controllerOperation: null,
    detectedSettings: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    transcript: [],
    log: [],
  });
  vi.restoreAllMocks();
});

// A console-typed $$ owns the settings-read controllerOperation marker, which
// blocks Frame/Start/other console commands until the dump completes. If the
// dump never terminates (silent stall or an error reply), the marker must
// still be released — otherwise the machine is wedged until a controller reset.
describe('console $$ settings-read release', () => {
  it('releases the settings-read operation when a console $$ is rejected by the controller', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.setState({ detectedSettings: null, controllerSettings: null });

    const read = useLaserStore.getState().sendConsoleCommand('$$');
    await flushConnect();
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'interactive-command',
      label: 'Reading controller settings',
    });

    connection.emitLine('error:9');
    await expect(read).rejects.toThrow(/error:9/i);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('releases the settings-read operation when a console $$ dump goes silent', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    vi.useFakeTimers();
    try {
      const read = useLaserStore.getState().sendConsoleCommand('$$');
      const rejection = expect(read).rejects.toThrow(/timed out/i);
      expect(useLaserStore.getState().controllerOperation).toMatchObject({
        kind: 'interactive-command',
        label: 'Reading controller settings',
      });

      // No settings lines, no ok — the command arbiter's timeout is the only
      // thing that can release the marker.
      await vi.advanceTimersByTimeAsync(9_000);
      await rejection;
      expect(useLaserStore.getState().controllerOperation).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
