import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { framedRunControllerSnapshot, type FramedRunCandidate } from './framed-run';
import { respondToStockGrblHandshakeQuery } from './laser-controller-handshake.test-support';
import { useLaserStore } from './laser-store';

export type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

type MotionOperationSnapshot = {
  readonly operationId?: number;
  readonly kind: 'frame' | 'jog';
  readonly sawControllerBusy: boolean;
  readonly idleStatusReports?: number;
  readonly dispatchComplete?: boolean;
  readonly pendingMotionTransportWrites?: number;
  readonly awaitingSettlementAck?: boolean;
  readonly settlementAckStatusSequence?: number;
  readonly cancelRequested?: boolean;
} | null;

export function getMotionOperation(): MotionOperationSnapshot {
  return (
    (useLaserStore.getState() as { readonly motionOperation?: MotionOperationSnapshot })
      .motionOperation ?? null
  );
}

export function setMotionOperation(operation: MotionOperationSnapshot): void {
  const normalized =
    operation === null
      ? null
      : { operationId: -1, dispatchComplete: false, idleStatusReports: 0, ...operation };
  useLaserStore.setState({ motionOperation: normalized } as Partial<
    ReturnType<typeof useLaserStore.getState>
  >);
}

export function makeConnection(
  write: (data: string) => Promise<void>,
  close: () => Promise<void> = async () => undefined,
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      respondToStockGrblHandshakeQuery(data, emitLine);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close,
    emitLine,
  };
}

function makeAdapter(connection: SerialConnection): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({
        open: async () => connection,
      }),
    },
  };
}

export async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flushHandshake();
  connection.emitLine('ok');
  await flushHandshake();
}

async function flushHandshake(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

export async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

export async function acknowledgeToolOffLine(connection: FakeConnection): Promise<void> {
  connection.emitLine('ok');
  await flush();
}

export async function acknowledgeFrameToolOffPrelude(connection: FakeConnection): Promise<void> {
  await acknowledgeToolOffLine(connection);
  await acknowledgeToolOffLine(connection);
}

export async function acknowledgeAndSettleFrameLeg(connection: FakeConnection): Promise<void> {
  connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
}

export async function acknowledgeMotionSettlement(
  connection: FakeConnection,
  idleLine = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>',
): Promise<void> {
  await flush();
  connection.emitLine('ok');
  await flush();
  connection.emitLine(idleLine);
  await flush();
}

export function framedRunCandidate(): FramedRunCandidate {
  return {
    executionSignature: 'exact-reviewed-run',
    frameVerification: {
      boundsSignature: '0,0,10,10',
      wco: null,
      workOriginActive: false,
    },
    controllerBeforeFrame: framedRunControllerSnapshot(useLaserStore.getState()),
  } as FramedRunCandidate;
}
