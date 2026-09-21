import { selectControllerDriver, type ControllerDriver } from '../../core/controllers';
import type { PlatformAdapter, SerialPortIdentity, SerialPortRef } from '../../platform/types';
import {
  beginConnectAttempt,
  connectAttemptIsCurrent,
  connectAttemptWasForgotten,
  type ConnectAttempt,
} from './laser-connect-attempt';
import { disconnectedControllerQualification } from './laser-controller-qualification';
import { closeConnectionOnce } from './laser-connection-teardown';
import type { ConnectControllerOptions } from './laser-store-action-types';
import type { LaserState, LiveRefs } from './laser-store';
import type { SerialOpenRequest } from '../../platform/types';
import { isGrblFamilyDriver } from './laser-disconnect-transaction';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type LiveConnection = NonNullable<LiveRefs['connection']>;
type ClosePreviousFn = (connection: LiveConnection) => Promise<void>;
type AttachConnectionFn = (
  connection: LiveConnection,
  baudRate: number,
  portInfo: SerialPortIdentity | null,
) => void;
type ConnectingPatchFn = (state: LaserState, refs: LiveRefs) => Partial<LaserState>;

export async function runConnectAction(
  set: SetFn,
  refs: LiveRefs,
  adapter: PlatformAdapter,
  options: ConnectControllerOptions,
  closePrevious: ClosePreviousFn,
  connectingPatch: ConnectingPatchFn,
  attachConnection: AttachConnectionFn,
): Promise<void> {
  const attempt = beginConnectAttempt(refs);
  let requestedPort: SerialPortRef | null = null;
  let cancelledPermissionReleased = false;
  const releaseCancelledPermission = async (): Promise<void> => {
    if (
      cancelledPermissionReleased ||
      requestedPort === null ||
      !connectAttemptWasForgotten(refs, attempt)
    ) {
      return;
    }
    cancelledPermissionReleased = true;
    await requestedPort.forget?.();
  };
  const previousConnection = refs.connection;
  if (previousConnection !== null) {
    await closePrevious(previousConnection);
    if (!connectAttemptIsCurrent(refs, attempt)) {
      await closeCancelledConnection(refs, attempt, previousConnection);
      return;
    }
  }
  refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
  refs.nextTranscriptId = 1;
  refs.driver = selectControllerDriver(options.controllerKind, options.controllerCommandSet);
  set((state) => connectingPatch(state, refs));
  try {
    const portRef = await adapter.serial.requestPort();
    requestedPort = portRef;
    if (!connectAttemptIsCurrent(refs, attempt)) {
      await releaseCancelledPermission();
      return;
    }
    if (portRef === null) {
      set((state) => ({
        connection: { kind: 'disconnected' },
        controllerQualification: disconnectedControllerQualification(state.controllerSessionEpoch),
      }));
      return;
    }
    const baudRate = options.baudRate ?? refs.driver.defaultBaudRate;
    const connection = await portRef.open(serialOpenRequest(baudRate, options, refs.driver));
    if (!connectAttemptIsCurrent(refs, attempt)) {
      await closeCancelledConnection(refs, attempt, connection);
      return;
    }
    attachConnection(connection, baudRate, portRef.info ?? null);
  } catch (error) {
    if (!connectAttemptIsCurrent(refs, attempt)) {
      await releaseCancelledPermission().catch(() => undefined);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    set((state) => ({
      connection: { kind: 'failed', error: message },
      controllerQualification: disconnectedControllerQualification(state.controllerSessionEpoch),
    }));
  }
}

// Split out to keep runConnectAction under the complexity cap. The hosted
// transport is advisory: the platform silently keeps the main-thread one when
// it cannot hand the port to a worker (ADR-334).
function serialOpenRequest(
  baudRate: number,
  options: ConnectControllerOptions,
  driver: ControllerDriver,
): SerialOpenRequest {
  return {
    baudRate,
    // The worker pump understands GRBL acknowledgements only. A saved opt-in
    // may survive a controller change or arrive through an imported profile.
    ...(options.hostedStreaming === true && isGrblFamilyDriver(driver)
      ? { hostedStreaming: true }
      : {}),
  };
}

async function closeCancelledConnection(
  refs: LiveRefs,
  attempt: ConnectAttempt,
  connection: LiveConnection,
): Promise<void> {
  await closeConnectionOnce(refs, connection, connectAttemptWasForgotten(refs, attempt)).catch(
    () => undefined,
  );
}
