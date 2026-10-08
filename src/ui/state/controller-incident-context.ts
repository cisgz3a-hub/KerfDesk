import type { LaserState } from './laser-store';
import type { ControllerQualification } from './laser-controller-qualification';
import {
  jobTransportWritesInFlight,
  type JobTransportLedgerRefs,
} from './laser-job-transport-ledger';

type Position = Readonly<{ x: number; y: number; z: number }>;

/** Allowlisted event-time facts. Never retains a project, job plan or command bytes. */
export type ControllerIncidentContext = {
  readonly build: Readonly<{ version: string; commit: string; builtAt: string }>;
  readonly controller: Readonly<{
    sessionEpoch: number;
    selectedKind: string;
    detectedKind: string | null;
    commandSet: string | null;
    connection: string;
    baudRate: number | null;
    usb: Readonly<{ usbVendorId?: number; usbProductId?: number }> | null;
    qualification: ControllerQualification | null;
    firmwareLines: ReadonlyArray<string>;
    status: string | null;
    statusSequence: number;
    statusObservedAt: number | null;
    machinePosition: Position | null;
    workPosition: Position | null;
    alarmCode: number | null;
    lastError: number | null;
  }>;
  readonly run: Readonly<{
    id: string | null;
    machineKind: string | null;
    streamerEpoch: number;
    status: string | null;
    completed: number;
    total: number;
    queueIndex: number;
    inFlightLines: number;
    inFlightBytes: number;
    pendingUntrackedAcks: number;
    pendingTransportWrites: number;
    storePendingTransportWrites: number;
    refillPendingTransportWrites: number;
  }>;
};

export function controllerIncidentContext(
  state: Partial<LaserState>,
  refs: JobTransportLedgerRefs = {},
): ControllerIncidentContext | undefined {
  // Pure transcript-buffer harnesses supply only the rings: do not invent facts.
  if (state.controllerSessionEpoch === undefined || state.activeControllerKind === undefined) {
    return undefined;
  }
  return Object.freeze({
    build: Object.freeze({
      version: typeof __APP_VERSION__ === 'undefined' ? 'unknown' : bounded(__APP_VERSION__),
      commit: typeof __GIT_SHA__ === 'undefined' ? 'unknown' : bounded(__GIT_SHA__),
      builtAt: typeof __BUILD_TIME__ === 'undefined' ? 'unknown' : bounded(__BUILD_TIME__),
    }),
    controller: controllerFacts(state),
    run: runFacts(state, refs),
  });
}

function controllerFacts(state: Partial<LaserState>): ControllerIncidentContext['controller'] {
  return Object.freeze({
    sessionEpoch: count(state.controllerSessionEpoch),
    selectedKind: state.activeControllerKind ?? 'unknown',
    detectedKind: state.detectedControllerKind ?? null,
    commandSet: state.activeControllerCommandSet ?? null,
    connection: state.connection?.kind ?? 'unknown',
    baudRate: finite(state.connectedBaudRate),
    usb: usbFacts(state.serialPortInfo),
    qualification: qualificationFact(state.controllerQualification),
    firmwareLines: Object.freeze(
      (state.controllerBuildInfoRawLines ?? []).slice(0, 8).map(bounded),
    ),
    ...statusFacts(state),
    alarmCode: finite(state.alarmCode),
    lastError: finite(state.lastError),
  });
}

function usbFacts(
  usb: LaserState['serialPortInfo'],
): ControllerIncidentContext['controller']['usb'] {
  if (usb == null) return null;
  const vendor = finite(usb.usbVendorId);
  const product = finite(usb.usbProductId);
  return Object.freeze({
    ...(vendor === null ? {} : { usbVendorId: vendor }),
    ...(product === null ? {} : { usbProductId: product }),
  });
}

function statusFacts(state: Partial<LaserState>) {
  return {
    status: state.statusReport?.state ?? null,
    statusSequence: count(state.statusSequence),
    statusObservedAt: finite(state.statusObservation?.observedAt),
    machinePosition: position(state.statusReport?.mPos),
    workPosition: position(state.statusReport?.wPos),
  };
}

function runFacts(
  state: Partial<LaserState>,
  refs: JobTransportLedgerRefs,
): ControllerIncidentContext['run'] {
  const storePendingTransportWrites = count(state.pendingTransportWrites);
  const refillPendingTransportWrites = count(jobTransportWritesInFlight(refs));
  return Object.freeze({
    id: state.activeRunId == null ? null : bounded(state.activeRunId),
    machineKind: state.activeJobMachineKind ?? null,
    streamerEpoch: count(state.streamerEpoch),
    status: state.streamer?.status ?? null,
    completed: count(state.streamer?.completed),
    total: count(state.streamer?.total),
    queueIndex: count(state.streamer?.queueIndex),
    inFlightLines: count(state.streamer?.inFlight.length),
    inFlightBytes: count(state.streamer?.inFlightBytes),
    pendingUntrackedAcks: count(state.pendingUntrackedAcks),
    pendingTransportWrites: count(storePendingTransportWrites + refillPendingTransportWrites),
    storePendingTransportWrites,
    refillPendingTransportWrites,
  });
}

function qualificationFact(
  value: ControllerQualification | undefined,
): ControllerQualification | null {
  if (value === undefined) return null;
  return Object.freeze({
    ...value,
    epoch: count(value.epoch),
    ...(value.kind === 'failed' ? { message: bounded(value.message) } : {}),
  });
}

function position(value: Position | null | undefined): Position | null {
  if (value == null || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function count(value: number | null | undefined): number {
  return finite(value) ?? 0;
}

function bounded(value: string): string {
  return value.slice(0, 512);
}
