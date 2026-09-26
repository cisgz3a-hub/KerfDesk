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
import {
  BACKGROUND_STREAMING_FALLBACK_LOG,
  backgroundStreamingFallbackWarning,
} from './laser-background-streaming-notice';
import { pushLog } from './laser-store-helpers';
import { connectionScopedEvidenceReset } from './laser-module-probe';
import { useToastStore } from './toast-store';

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

/** Why a file-only profile (ADR-097: Ruida .rd export) cannot Connect. The
 *  menu and palette Connect command shows the same text as its disabled reason. */
export const FILE_ONLY_CONNECT_REFUSAL =
  'This machine profile exports .rd files only; it has no live connection.';

export async function runConnectAction(
  set: SetFn,
  refs: LiveRefs,
  adapter: PlatformAdapter,
  options: ConnectControllerOptions,
  closePrevious: ClosePreviousFn,
  connectingPatch: ConnectingPatchFn,
  attachConnection: AttachConnectionFn,
): Promise<void> {
  // A file-only driver has no protocol to speak over a serial port, so this
  // refusal is a factual transport inability, not a policy gate. It comes
  // before the picker and before any live connection or attempt is touched
  // (audit RU-6).
  const driver = selectControllerDriver(options.controllerKind, options.controllerCommandSet);
  if (driver.capabilities.transport === 'file-only') {
    set((state) => ({ log: pushLog(state, FILE_ONLY_CONNECT_REFUSAL) }));
    useToastStore.getState().pushToast(FILE_ONLY_CONNECT_REFUSAL, 'error');
    return;
  }
  await connectSerialController(
    set,
    refs,
    adapter,
    options,
    driver,
    closePrevious,
    connectingPatch,
    attachConnection,
  );
}

async function connectSerialController(
  set: SetFn,
  refs: LiveRefs,
  adapter: PlatformAdapter,
  options: ConnectControllerOptions,
  driver: ControllerDriver,
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
  refs.driver = driver;
  set((state) => ({ ...connectingPatch(state, refs), ...connectionScopedEvidenceReset() }));
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
    reportBackgroundStreaming(set, connection, adapter.id);
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

// Every host records the fallback; only a host whose hidden window pauses
// sending asks the operator to keep KerfDesk visible (ADR-354 Amendment 1).
function reportBackgroundStreaming(
  set: SetFn,
  connection: LiveConnection,
  host: PlatformAdapter['id'],
): void {
  if (connection.backgroundStreamingUnavailable !== true) return;
  set((state) => ({ log: pushLog(state, BACKGROUND_STREAMING_FALLBACK_LOG) }));
  const warning = backgroundStreamingFallbackWarning(host);
  if (warning !== null) useToastStore.getState().pushToast(warning, 'warning');
}

// Split out to keep runConnectAction under the complexity cap. The hosted
// transport is preferred for compatible drivers. Explicit false preserves an
// operator's ordinary-transport choice; unsupported runtimes retain the picked port.
function serialOpenRequest(
  baudRate: number,
  options: ConnectControllerOptions,
  driver: ControllerDriver,
): SerialOpenRequest {
  return {
    baudRate,
    // The worker pump understands GRBL acknowledgements only. An old profile
    // may survive a controller change or arrive through an imported project.
    ...(options.hostedStreaming !== false && isGrblFamilyDriver(driver)
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
