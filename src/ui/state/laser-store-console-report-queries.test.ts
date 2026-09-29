// Controller audit 2 (ADR-375), C-6: a Console report command that only prints
// (GRBL `$` help and `$N` startup-line listing, grbl/system.c#L129 and
// #L237-L246) must leave the completed Frame and the trusted position alone,
// as `$#` does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFramedRunPermit, type FramedRunCandidate } from './framed-run';
import { useLaserStore } from './laser-store';
import { connectWith, flushConnect, makeConnection } from './laser-store-console.test-support';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    lastWriteError: null,
    log: [],
    transcript: [],
    framedRun: null,
    frameVerification: null,
    trustedPositionEpoch: 0,
  });
  vi.restoreAllMocks();
});

describe('Console report commands keep the completed Frame', () => {
  it.each(['$', '$N'])('%s keeps the Frame permit and the position epoch', async (line) => {
    const writes: string[] = [];
    // Answer status queries so a command wrongly held for a fresh Idle still
    // reaches the wire and the assertions below, instead of timing out.
    const connection = makeConnection(
      async (data) => {
        writes.push(data);
      },
      { autoRespondToStatusQuery: true },
    );
    await connectWith(connection);
    // The candidate payload is irrelevant to this store-level evidence test.
    const permit = createFramedRunPermit({} as FramedRunCandidate, useLaserStore.getState());
    useLaserStore.setState({ framedRun: permit });
    const positionEpoch = useLaserStore.getState().trustedPositionEpoch;
    writes.length = 0;

    await useLaserStore.getState().sendConsoleCommand(line);
    connection.emitLine('ok');
    await flushConnect();

    expect(writes.filter((data) => data !== '?')).toEqual([`${line}\n`]);
    expect(useLaserStore.getState().framedRun).toBe(permit);
    expect(useLaserStore.getState().trustedPositionEpoch).toBe(positionEpoch);
  });
});
