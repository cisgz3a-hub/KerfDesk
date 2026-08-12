import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFramedRunPermit, type FramedRunCandidate } from './framed-run';
import { useLaserStore } from './laser-store';
import { connectWith, makeConnection } from './laser-store-console.test-support';

const PROVENANCE = {
  kind: 'user-macro' as const,
  macroName: 'Nudge X',
  macroTemplate: 'G0 X{{distance}}',
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    transcript: [],
    frameVerification: null,
    framedRun: null,
  });
  vi.restoreAllMocks();
});

describe('saved user macro Console dispatch', () => {
  it('keeps a read-only macro on the Console path without minting a permit or streamer', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.getState().clearTranscript();

    await useLaserStore.getState().sendConsoleCommand('$#', { provenance: PROVENANCE });

    expect(useLaserStore.getState()).toMatchObject({ framedRun: null, streamer: null });
    expect(useLaserStore.getState().transcript).toMatchObject([
      { direction: 'out', raw: '$#\n', source: 'macro' },
      {
        direction: 'system',
        raw: 'User macro "Nudge X" dispatched through Console: $#',
        source: 'macro',
      },
    ]);
  });

  it('preserves an existing permit only for a read-only macro', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    const permit = createFramedRunPermit(
      // The candidate payload is not read by this store-level preservation check.
      {} as FramedRunCandidate,
      useLaserStore.getState(),
    );
    useLaserStore.setState({ framedRun: permit });

    await useLaserStore.getState().sendConsoleCommand('$#', { provenance: PROVENANCE });

    expect(useLaserStore.getState().framedRun).toBe(permit);
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('invalidates a permit before a mutating macro write and never starts a stream', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    const permit = createFramedRunPermit(
      // The candidate payload is not read by this store-level invalidation check.
      {} as FramedRunCandidate,
      useLaserStore.getState(),
    );
    useLaserStore.getState().clearTranscript();
    writes.length = 0;
    useLaserStore.setState({ framedRun: permit });

    const dispatch = useLaserStore
      .getState()
      .sendConsoleCommand('G0 X2.5', { provenance: PROVENANCE });
    expect(useLaserStore.getState().framedRun).toBeNull();
    await dispatch;

    expect(writes).toEqual(['G0 X2.5\n']);
    expect(useLaserStore.getState()).toMatchObject({ framedRun: null, streamer: null });
    expect(useLaserStore.getState().transcript).toMatchObject([
      { direction: 'out', raw: 'G0 X2.5\n', source: 'macro' },
      {
        direction: 'system',
        raw: 'User macro "Nudge X" dispatched through Console: G0 X2.5',
        source: 'macro',
      },
    ]);
  });

  it('does not record success provenance when the transport rejects the write', async () => {
    let shouldRejectWrites = false;
    const connection = makeConnection(async () => {
      if (!shouldRejectWrites) return;
      throw new Error('adapter rejected macro write');
    });
    await connectWith(connection);
    useLaserStore.getState().clearTranscript();
    shouldRejectWrites = true;

    await expect(
      useLaserStore.getState().sendConsoleCommand('G0 X2.5', { provenance: PROVENANCE }),
    ).rejects.toThrow('adapter rejected macro write');
    expect(useLaserStore.getState().transcript).toEqual([]);
    expect(useLaserStore.getState()).toMatchObject({ framedRun: null, streamer: null });
  });
});
