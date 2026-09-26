// The model behind Find my machine (ADR-420): connect with the draft's
// controller contract, reuse the remembered port, try the common speeds when
// nothing answers, and reconnect once with the firmware the banner named.
// Everything here reads; no setting is written and nothing moves.

import { useEffect, useRef, useState } from 'react';
import { selectControllerDriver } from '../../../core/controllers';
import { usePlatform } from '../../app/platform-context';
import { connectOptionsForDevice } from '../../commands/connect-options';
import { waitForControllerQueueSettled } from '../../state/controller-queue-settle';
import { useLaserStore, type ConnectControllerOptions } from '../../state/laser-store';
import { useToastStore } from '../../state/toast-store';
import {
  baudScanAnswer,
  baudScanCandidates,
  createBaudScanOwnership,
  scanBaudRates,
  type BaudScanAnswer,
} from './device-setup-baud-scan';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { machineSetupControllerGuide } from './machine-setup-controller-guide';
import { liveConnectionAttempt, type DeviceSetupAutomatic } from './use-controller-auto-fill';

const ANSWER_WAIT_MS = 4_000;

export type BaudScanStatus =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'running';
      readonly baudRate: number;
      readonly index: number;
      readonly of: number;
    }
  | { readonly kind: 'none'; readonly tried: ReadonlyArray<number> };

export function useFindMachine(
  state: DeviceSetupStepProps['state'],
  automatic?: DeviceSetupAutomatic,
) {
  const platform = usePlatform();
  const laser = useFindLaserState();
  const pushToast = useToastStore((s) => s.pushToast);
  const controllerKind = state.draft.controllerKind ?? 'grbl-v1.1';
  const driver = selectControllerDriver(controllerKind, state.draft.controllerCommandSet);
  const guide = machineSetupControllerGuide(controllerKind, state.draft.controllerCommandSet);
  const baudRate = state.draft.baudRate ?? guide.defaultBaudRate;
  const connected = laser.connection.kind === 'connected';
  const mismatch =
    connected &&
    (laser.activeControllerKind !== controllerKind ||
      (laser.activeControllerCommandSet ?? null) !== (driver.commandSet ?? null) ||
      (laser.detectedControllerKind !== null && laser.detectedControllerKind !== controllerKind));
  // The options the rail and menu Connect build from a profile, so the draft's
  // Background streaming choice travels as they send it, an explicit opt-out
  // included (2026-09-25 audit, SER-2). Setup keeps its controller and baud
  // fallbacks.
  const options = (extra: Partial<ConnectControllerOptions> = {}): ConnectControllerOptions => ({
    ...connectOptionsForDevice(state.draft),
    controllerKind,
    baudRate,
    ...extra,
  });
  const showError = (error: unknown): void =>
    pushToast(error instanceof Error ? error.message : String(error), 'error');
  const openConnection = (extra?: Partial<ConnectControllerOptions>): Promise<void> =>
    laser.connect(platform, options(extra));
  // A failed attempt shows as the connection's own failure; the scan reads it.
  const connectAt = (baud: number): Promise<void> =>
    openConnection({ baudRate: baud }).catch(() => undefined);
  const scan = useBaudScan(connectAt, laser.disconnect, baudRate, automatic);
  const actions = findConnectionActions({
    openConnection,
    disconnect: laser.disconnect,
    stopScan: scan.stop,
    automatic,
    showError,
  });
  useAdoptDetectedFirmware(
    mismatch,
    laser.detectedControllerKind,
    controllerKind,
    automatic,
    actions.reconnectForFind,
  );
  return {
    baudRate,
    choosePort: actions.choosePort,
    connected,
    controllerKind,
    driver,
    find: actions.find,
    guide,
    laser,
    mismatch,
    readAgain: () => void readController(guide, driver, laser).catch(showError),
    reconnect: () => void actions.reconnect().catch(showError),
    disconnect: actions.disconnect,
    scan,
    supportsSerial: platform.serial.isSupported(),
  };
}

export type FindMachineModel = ReturnType<typeof useFindMachine>;

// Setup's connection actions. Find's claim is the connect attempt it started:
// connect() takes its attempt revision before its first await, so the claim is
// read right after the call. Every action takes the connection from a running
// scan first.
function findConnectionActions(deps: {
  readonly openConnection: (extra?: Partial<ConnectControllerOptions>) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly stopScan: () => void;
  readonly automatic: DeviceSetupAutomatic | undefined;
  readonly showError: (error: unknown) => void;
}) {
  const { openConnection, disconnect, stopScan, automatic, showError } = deps;
  const openForFind = (
    claim: (attempt: number) => void,
    extra?: Partial<ConnectControllerOptions>,
  ): Promise<void> => {
    const opening = openConnection(extra);
    claim(liveConnectionAttempt());
    return opening;
  };
  const requestFind = (attempt: number): void => automatic?.requestFind(attempt);
  return {
    find: (): void => {
      stopScan();
      void openForFind(requestFind).catch(showError);
    },
    choosePort: (): void => {
      stopScan();
      void (async () => {
        if (useLaserStore.getState().connection.kind === 'connected') await disconnect();
        await openForFind(requestFind, { portSelection: 'choose' });
      })().catch(showError);
    },
    reconnect: async (): Promise<void> => {
      stopScan();
      await disconnect();
      await openConnection();
    },
    disconnect: (): void => {
      stopScan();
      void disconnect().catch(showError);
    },
    // Find's follow-up reconnect with the adopted firmware keeps Find's claim.
    reconnectForFind: async (): Promise<void> => {
      stopScan();
      await disconnect();
      await openForFind((attempt) => automatic?.continueFind(attempt));
    },
  };
}

function useFindLaserState() {
  return {
    connection: useLaserStore((s) => s.connection),
    qualification: useLaserStore((s) => s.controllerQualification),
    statusReport: useLaserStore((s) => s.statusReport),
    activeControllerKind: useLaserStore((s) => s.activeControllerKind),
    activeControllerCommandSet: useLaserStore((s) => s.activeControllerCommandSet),
    detectedControllerKind: useLaserStore((s) => s.detectedControllerKind),
    detectedSettings: useLaserStore((s) => s.detectedSettings),
    serialPortInfo: useLaserStore((s) => s.serialPortInfo ?? null),
    connectedBaudRate: useLaserStore((s) => s.connectedBaudRate ?? null),
    controllerOperation: useLaserStore((s) => s.controllerOperation),
    connect: useLaserStore((s) => s.connect),
    disconnect: useLaserStore((s) => s.disconnect),
    readMachineSettings: useLaserStore((s) => s.readMachineSettings),
    sendConsoleCommand: useLaserStore((s) => s.sendConsoleCommand),
  };
}

// The banner named a different firmware in the same family and auto-fill
// adopted it in the draft: reconnect once per Find press so the right driver
// reads it. Only on the connection Find opened, so a connection made
// elsewhere, before setup or after Find, is never dropped by setup: a new
// machine's draft fills itself without Find, but that does not make the
// connection Find's.
function useAdoptDetectedFirmware(
  mismatch: boolean,
  detected: string | null,
  draftKind: string,
  automatic: DeviceSetupAutomatic | undefined,
  reconnect: () => Promise<void>,
): void {
  const reconnectedFor = useRef<number | null>(null);
  const findCount = automatic?.findCount ?? 0;
  const adopted =
    automatic?.findOwnsConnection === true &&
    automatic.record?.status === 'applied' &&
    automatic.record.summary.controllerKind !== null;
  useEffect(() => {
    if (reconnectedFor.current === findCount) return;
    if (!mismatch || !adopted || detected !== draftKind) return;
    reconnectedFor.current = findCount;
    void reconnect().catch(() => undefined);
  }, [adopted, detected, draftKind, findCount, mismatch, reconnect]);
}

// Stop, a new scan and closing setup each retire the running scan, which then
// touches neither the connection nor the status again.
function useBaudScan(
  connectAt: (baudRate: number) => Promise<void>,
  disconnect: () => Promise<void>,
  currentBaud: number,
  automatic: DeviceSetupAutomatic | undefined,
) {
  const [status, setStatus] = useState<BaudScanStatus>({ kind: 'idle' });
  const [ownership] = useState(createBaudScanOwnership);
  useEffect(() => () => ownership.retire(), [ownership]);
  const start = (): void => {
    const retired = ownership.claim();
    // A scan from the connection Find opened keeps Find's claim on each speed.
    const connection = scanConnectionOwnership(
      automatic?.findOwnsConnection === true ? automatic.continueFind : undefined,
    );
    const candidates = baudScanCandidates([currentBaud]);
    const report = (next: BaudScanStatus): void => {
      if (!retired()) setStatus(next);
    };
    void scanBaudRates(
      {
        connectAt: (baud) => connection.open(() => connectAt(baud)),
        disconnect: () => connection.close(disconnect),
        awaitAnswer,
        cancelled: () => retired() || connection.replaced(),
      },
      candidates,
      (baudRate, index) =>
        report({ kind: 'running', baudRate, index: index + 1, of: candidates.length }),
    )
      .then((result) =>
        report(result.kind === 'none' ? { kind: 'none', tried: result.tried } : { kind: 'idle' }),
      )
      .catch(() => report({ kind: 'idle' }));
  };
  const stop = (): void => {
    ownership.retire();
    setStatus({ kind: 'idle' });
  };
  return { status, start, stop };
}

// The connection a scan opened is the scan's while the store's connect attempt
// is the one the scan started. connect() and disconnect() move the revision
// before their first await, so the scan reads its own right after each call,
// and any connect or disconnect it did not make (auto-connect on a replug, or
// one that lands while the scan's open is still pending) reads as replaced.
export function scanConnectionOwnership(onOpened?: (attempt: number) => void) {
  let owned: number | null = null;
  return {
    open: (connect: () => Promise<void>): Promise<void> => {
      const opening = connect();
      owned = liveConnectionAttempt();
      onOpened?.(owned);
      return opening;
    },
    close: (disconnect: () => Promise<void>): Promise<void> => {
      const closing = disconnect();
      owned = liveConnectionAttempt();
      return closing;
    },
    replaced: (): boolean => owned !== null && liveConnectionAttempt() !== owned,
  };
}

function awaitAnswer(): Promise<BaudScanAnswer> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: BaudScanAnswer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(answer);
    };
    const check = (): void => {
      const answer = baudScanAnswer(useLaserStore.getState());
      if (answer !== null) finish(answer);
    };
    const unsubscribe = useLaserStore.subscribe(check);
    const timer = setTimeout(() => finish('silent'), ANSWER_WAIT_MS);
    check();
  });
}

async function readController(
  guide: ReturnType<typeof machineSetupControllerGuide>,
  driver: ReturnType<typeof selectControllerDriver>,
  laser: ReturnType<typeof useFindLaserState>,
): Promise<void> {
  for (const command of guide.identityCommands) await laser.sendConsoleCommand(command);
  for (const command of guide.settingsCommands) {
    if (command !== driver.commands.settingsQuery) {
      await laser.sendConsoleCommand(command);
      continue;
    }
    // A Console line resolves when its bytes leave, not on the ok, and the
    // settings read refuses while an ok is still owed (settings-console-3).
    if (!(await waitForControllerQueueSettled())) {
      throw new Error(
        'The controller did not acknowledge the identity query in time. Check the connection, then read again.',
      );
    }
    await laser.readMachineSettings();
  }
}
