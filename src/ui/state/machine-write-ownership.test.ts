import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { createSafeWrite, type SafeWriteRefs } from './laser-safe-write';
import { initialLaserState } from './laser-store-helpers';
import { useLaserStore } from './laser-store';
import { ownedMachineWrite } from './machine-execution-owner';
import { dispatchQueuedMotionLine } from './laser-frame-dispatch';
import { startMotionOperation } from './laser-motion-operation';

const cleanups: (() => void)[] = [];
beforeEach(() => useLaserStore.setState(initialLaserState()));
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  useLaserStore.setState(initialLaserState());
});
function transport() {
  const conn = {
    write: vi.fn(async () => undefined),
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
  };
  const refs: SafeWriteRefs = {
    connection: conn,
    driver: grblDriver,
    nextTranscriptId: 1,
    writeEpoch: 0,
  };
  return {
    conn,
    refs,
    write: createSafeWrite(useLaserStore.setState, useLaserStore.getState, refs),
  };
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('machine authority at the actual transport dispatch boundary', () => {
  it('composes nested canonical and remote guards after synchronous store publication', async () => {
    const { conn, refs, write } = transport();
    const remote = new AbortController();
    let canonical = true;
    cleanups.push(
      useLaserStore.subscribe((state) => {
        if (state.pendingTransportWrites === 1) canonical = false;
      }),
    );
    const guarded = ownedMachineWrite(ownedMachineWrite(write, { signal: remote.signal }), {
      assertCurrent: () => {
        if (!canonical) throw new Error('motion owner changed');
      },
    });
    await expect(guarded('$J=G91 X1 F100\n', 'jog')).rejects.toThrow('motion owner changed');
    expect(conn.write).not.toHaveBeenCalled();
    expect(useLaserStore.getState()).toMatchObject({
      pendingTransportWrites: 0,
      pendingUntrackedAcks: 0,
    });
    expect(refs.untrackedAckReservations).toHaveLength(0);
  });

  it('refuses remote revocation published by pending-write bookkeeping before any byte', async () => {
    const { conn, write } = transport();
    const controller = new AbortController();
    cleanups.push(
      useLaserStore.subscribe((state) => {
        if (state.pendingTransportWrites === 1) controller.abort();
      }),
    );
    await expect(
      ownedMachineWrite(write, { signal: controller.signal })('G1 X1\n', 'frame'),
    ).rejects.toThrow();
    expect(conn.write).not.toHaveBeenCalled();
    expect(useLaserStore.getState()).toMatchObject({
      pendingTransportWrites: 0,
      pendingUntrackedAcks: 0,
    });
  });

  it('an unsent old write never decrements a replacement session reservation', async () => {
    const { conn, refs, write } = transport();
    let changed = false;
    cleanups.push(
      useLaserStore.subscribe((state) => {
        if (changed || state.pendingTransportWrites !== 1) return;
        changed = true;
        refs.writeEpoch = 1;
        refs.connection = { ...conn, write: vi.fn(async () => undefined) };
        refs.untrackedAckReservations = [];
        useLaserStore.setState({ pendingTransportWrites: 3, pendingUntrackedAcks: 4 });
      }),
    );
    await expect(write('G1 X1\n', 'frame')).rejects.toThrow(/serial session changed/i);
    expect(conn.write).not.toHaveBeenCalled();
    expect(useLaserStore.getState()).toMatchObject({
      pendingTransportWrites: 3,
      pendingUntrackedAcks: 4,
    });
  });

  it('queued Frame legs retain the live caller guard through every prefix and restore', async () => {
    const { conn, write } = transport();
    const controller = new AbortController();
    const motion = {
      ...startMotionOperation('frame'),
      executionOwner: { signal: controller.signal },
    };
    useLaserStore.setState({ motionOperation: motion });
    dispatchQueuedMotionLine(
      useLaserStore.setState,
      useLaserStore.getState,
      write,
      'M5\n',
      motion.operationId,
    );
    await flush();
    expect(conn.write).toHaveBeenCalledWith('M5\n');
    controller.abort();
    dispatchQueuedMotionLine(
      useLaserStore.setState,
      useLaserStore.getState,
      write,
      '$J=G90 X1 F100\n',
      motion.operationId,
    );
    await flush();
    expect(conn.write).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().motionOperation?.cancelRequested).toBe(true);
  });

  it('an old queued leg cannot cancel a replacement owner installed before its microtask', async () => {
    const { conn, write } = transport();
    const old = startMotionOperation('frame');
    const replacement = startMotionOperation('jog');
    useLaserStore.setState({ motionOperation: old });
    dispatchQueuedMotionLine(
      useLaserStore.setState,
      useLaserStore.getState,
      write,
      'M5\n',
      old.operationId,
    );
    useLaserStore.setState({ motionOperation: replacement });
    await flush();
    expect(conn.write).not.toHaveBeenCalled();
    expect(useLaserStore.getState().motionOperation).toBe(replacement);
  });
});
