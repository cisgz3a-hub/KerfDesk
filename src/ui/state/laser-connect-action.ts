import { selectControllerDriver, type ControllerDriver } from '../../core/controllers';
import type { PlatformAdapter, SerialPortIdentity, SerialPortRef } from '../../platform/types';
import {
  beginConnectAttempt,
  connectAttemptIsCurrent,
  connectAttemptWasForgotten,
  type ConnectAttempt,
} from './laser-connect-attempt';
import { runConnectAfterPermissionCleanup } from './laser-connect-permission-cleanup';
import { disconnectedControllerQualification } from './laser-controller-qualification';
import { closeConnectionOnce } from './laser-connection-teardown';
import type { ConnectControllerOptions } from './laser-store-action-types';
import type { ConnectionState, LaserState, LiveRefs } from './laser-store';
import type { SerialOpenRequest } from '../../platform/types';
import { hostedStreamAcknowledgements } from './hosted-stream-acks';
import {
  BACKGROUND_STREAMING_FALLBACK_LOG,
  BACKGROUND_STREAMING_OFF_LOG,
  backgroundStreamingFallbackWarning,
} from './laser-background-streaming-notice';
import { pushLog } from './laser-store-helpers';
import { publishControllerIncident } from './laser-incident-publish';
import { connectionScopedEvidenceReset } from './laser-module-probe';
import { useToastStore } from './toast-store';
import { browserLocalStorage } from './browser-local-storage';
import { clearCncLiveCaps } from './detected-settings-action';
import {
  clearAutoConnectSkipped,
  noteAutoConnectSkipped,
  resumeAutoConnect,
} from './auto-connect-session';
import {
  chooseGrantedPort,
  loadRememberedSerialPort,
  rememberSerialPort,
} from './serial-port-memory';

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

export const NETWORK_RECONNECT_GUIDANCE =
  'Reconnect from the network connection form in Machine details. To switch to USB, choose Use a different port… explicitly.';

export async function runConnectAction(
  set: SetFn,
  get: () => LaserState,
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
  clearAutoConnectSkipped();
  const driver = selectControllerDriver(options.controllerKind, options.controllerCommandSet);
  if (driver.capabilities.transport === 'file-only') {
    set((state) => ({ log: pushLog(state, FILE_ONLY_CONNECT_REFUSAL) }));
    useToastStore.getState().pushToast(FILE_ONLY_CONNECT_REFUSAL, 'error');
    return;
  }
  if (
    get().lastConnectionTransport === 'tcp' &&
    adapter.serial.transport !== 'tcp' &&
    options.portSelection !== 'choose'
  ) {
    if (options.portSelection !== 'automatic') {
      set((state) => ({ log: pushLog(state, NETWORK_RECONNECT_GUIDANCE) }));
      useToastStore.getState().pushToast(NETWORK_RECONNECT_GUIDANCE, 'warning');
    }
    return;
  }
  clearCncLiveCaps();
  const attempt = beginTransportConnectAttempt(set, refs, adapter);
  await runConnectAfterPermissionCleanup(refs, attempt, () =>
    connectSerialController(
      set,
      refs,
      adapter,
      options,
      driver,
      closePrevious,
      connectingPatch,
      attachConnection,
      attempt,
    ),
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
  attempt: ConnectAttempt,
): Promise<void> {
  let requestedPort: SerialPortRef | null = null;
  const attemptedBaudRate = options.baudRate ?? driver.defaultBaudRate;
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
  refs.driver = driver;
  set((state) => ({ ...connectingPatch(state, refs), ...connectionScopedEvidenceReset() }));
  try {
    const portRef = await resolveSerialPort(adapter, options.portSelection, () =>
      connectAttemptIsCurrent(refs, attempt),
    );
    requestedPort = portRef;
    if (!connectAttemptIsCurrent(refs, attempt)) {
      await releaseCancelledPermission();
      return;
    }
    if (portRef === null) {
      const noPortChosen = picksPort(options.portSelection);
      set((state) => ({
        connection: noPortChosen ? NO_PORT_CHOSEN : { kind: 'disconnected' },
        controllerQualification: disconnectedControllerQualification(state.controllerSessionEpoch),
        ...(noPortChosen ? { log: pushLog(state, `[lf2] ${NO_PORT_CHOSEN_LOG}`) } : {}),
      }));
      return;
    }
    set({ lastConnectionTransport: selectedTransport(portRef, adapter) });
    const baudRate = attemptedBaudRate;
    const connection = await portRef.open(serialOpenRequest(baudRate, options, refs.driver));
    if (!connectAttemptIsCurrent(refs, attempt)) {
      await closeCancelledConnection(refs, attempt, connection);
      return;
    }
    attachRememberedConnection(attachConnection, connection, baudRate, portRef);
    liftAutoConnectPauseOnOpen(options.portSelection);
    reportBackgroundStreaming(set, connection, adapter.id, optedOutOfWorker(options, driver));
  } catch (error) {
    if (!connectAttemptIsCurrent(refs, attempt)) {
      await releaseCancelledPermission().catch(() => undefined);
      return;
    }
    reportConnectionFailure(set, refs, options, attemptedBaudRate, requestedPort, error);
  }
}

// Any attempt clears the last automatic attempt's hint. Only a connect someone
// asked for that opened its port lifts the pause their Disconnect set, so a
// cancelled picker or a failed open leaves it set (ADR-639).
function liftAutoConnectPauseOnOpen(selection: ConnectControllerOptions['portSelection']): void {
  if (selection !== 'automatic') resumeAutoConnect();
}

// Nobody clicked, so a failed background open (the port held by LightBurn or
// LaserGRBL, or unplugged mid-open) is no alert and no incident: one log line,
// the ordinary disconnected state and the rail's quiet hint (ADR-639).
function reportAutomaticConnectSkipped(set: SetFn, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  set((state) => ({
    log: pushLog(state, `[lf2] Automatic connect skipped: ${message}`),
    connection: { kind: 'disconnected' },
    controllerQualification: disconnectedControllerQualification(state.controllerSessionEpoch),
  }));
  noteAutoConnectSkipped(message);
}

function reportConnectionFailure(
  set: SetFn,
  refs: LiveRefs,
  options: ConnectControllerOptions,
  baudRate: number,
  port: SerialPortRef | null,
  error: unknown,
): void {
  if (options.portSelection === 'automatic') {
    reportAutomaticConnectSkipped(set, error);
    return;
  }
  const portInfo: SerialPortIdentity | null = port?.info ?? null;
  const message = error instanceof Error ? error.message : String(error);
  set((state) => ({
    ...publishControllerIncident(
      refs,
      { ...state, connectedBaudRate: baudRate, serialPortInfo: portInfo },
      `[lf2] Controller connection failed: ${message}`,
    ),
    connection: { kind: 'failed', error: message },
    controllerQualification: disconnectedControllerQualification(state.controllerSessionEpoch),
  }));
}

function beginTransportConnectAttempt(
  set: SetFn,
  refs: LiveRefs,
  adapter: PlatformAdapter,
): ConnectAttempt {
  const attempt = beginConnectAttempt(refs);
  set({
    connectionAttempt: attempt.revision,
    // A queued explicit choice already owns selection; grant events must not
    // replace it with auto-connect while forgotten permissions finish cleanup.
    ...(refs.connection === null ? { connection: { kind: 'connecting' as const } } : {}),
    ...(adapter.serial.transport === 'tcp' ? { lastConnectionTransport: 'tcp' } : {}),
  });
  return attempt;
}

function selectedTransport(port: SerialPortRef, adapter: PlatformAdapter): 'serial' | 'tcp' {
  return port.info?.transport ?? adapter.serial.transport ?? 'serial';
}

// The machine's port opens without the picker when chooseGrantedPort finds it
// among the ports the operator picked before (ADR-420). 'choose' always asks;
// 'automatic' and 'remembered-only' never do, because auto-connect and a
// remote Connect have no click on this PC to show a picker with, and a null
// result reads as a cancelled picker.
async function resolveSerialPort(
  adapter: PlatformAdapter,
  selection: ConnectControllerOptions['portSelection'] = 'remembered',
  isCurrent: () => boolean,
): Promise<SerialPortRef | null> {
  if (selection !== 'choose' && adapter.serial.grantedPorts !== undefined) {
    // Forget clears stored identity while enumeration may still be pending.
    // Retain this attempt's intended choice for its cancelled-permission cleanup.
    const remembered = loadRememberedSerialPort(browserLocalStorage());
    const granted = await adapter.serial.grantedPorts();
    const choice = chooseGrantedPort(granted, remembered);
    if (choice.kind === 'use') return choice.port;
    // A cancelled attempt may retire its selected grant, never launch a picker.
    if (!isCurrent()) return null;
  }
  if (!picksPort(selection)) return null;
  return adapter.serial.requestPort();
}

function picksPort(selection: ConnectControllerOptions['portSelection']): boolean {
  return selection !== 'automatic' && selection !== 'remembered-only';
}

// A port picker that returns nothing was cancelled or listed no port. Web
// Serial reports both as NotFoundError, so the hint names both, and the usual
// cause of an empty list: a missing USB-serial driver. The desktop app's own
// empty-list box says the same (electron/serial-port-wait.ts). It used to
// return silently to "Not connected" (2026-07-10 S12-F2, UX audit U2 KNOWN).
const NO_PORT_CHOSEN: ConnectionState = { kind: 'disconnected', noPortChosen: true };

const NO_PORT_CHOSEN_LOG =
  'No port was chosen. If the machine was not in the list, its USB driver (CH340 or CP210x) may be missing.';

// The port that opened is the one Connect reuses next time (ADR-420).
function attachRememberedConnection(
  attachConnection: AttachConnectionFn,
  connection: LiveConnection,
  baudRate: number,
  portRef: SerialPortRef,
): void {
  const info = portRef.info ?? null;
  rememberSerialPort(browserLocalStorage(), info);
  attachConnection(connection, baudRate, info);
}

// Every host records the fallback and shows it, since a busy window can stop
// the machine with a constant-power beam lit; only a host whose hidden window
// pauses sending also asks to keep KerfDesk visible (ADR-354 Amendment 1,
// ADR-676). A profile that turned the worker off chose this: the log says so,
// and Job Review warns for each job it affects.
function reportBackgroundStreaming(
  set: SetFn,
  connection: LiveConnection,
  host: PlatformAdapter['id'],
  optedOut: boolean,
): void {
  // Job Review warns about a lit stop only where the window refills the stream.
  set({
    jobStreamHost: connection.hostedStreaming === undefined ? 'window' : 'worker',
    connectionHost: host,
  });
  if (connection.backgroundStreamingUnavailable !== true) {
    if (optedOut) set((state) => ({ log: pushLog(state, BACKGROUND_STREAMING_OFF_LOG) }));
    return;
  }
  set((state) => ({ log: pushLog(state, BACKGROUND_STREAMING_FALLBACK_LOG) }));
  useToastStore.getState().pushToast(backgroundStreamingFallbackWarning(host), 'warning');
}

function optedOutOfWorker(options: ConnectControllerOptions, driver: ControllerDriver): boolean {
  return options.hostedStreaming === false && hostedStreamAcknowledgements(driver) !== null;
}

// Split out to keep runConnectAction under the complexity cap. The hosted
// transport is preferred for compatible drivers. Explicit false preserves an
// operator's ordinary-transport choice; unsupported runtimes retain the picked port.
function serialOpenRequest(
  baudRate: number,
  options: ConnectControllerOptions,
  driver: ControllerDriver,
): SerialOpenRequest {
  // The worker pump reads GRBL's and Marlin's acknowledgements; each arm names
  // which (ADR-676). An old profile may survive a controller change or arrive
  // in an imported project.
  return {
    baudRate,
    ...(options.hostedStreaming !== false && hostedStreamAcknowledgements(driver) !== null
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
