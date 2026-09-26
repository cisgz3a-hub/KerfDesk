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
  scanBaudRates,
  type BaudScanAnswer,
} from './device-setup-baud-scan';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { machineSetupControllerGuide } from './machine-setup-controller-guide';
import type { DeviceSetupAutomatic } from './use-controller-auto-fill';

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
  const reconnect = async (): Promise<void> => {
    await laser.disconnect();
    await openConnection();
  };
  const find = (): void => {
    automatic?.requestFind();
    void openConnection().catch(showError);
  };
  const choosePort = (): void => {
    void (async () => {
      if (useLaserStore.getState().connection.kind === 'connected') await laser.disconnect();
      // After the old connection closes, so its read cannot fill the draft.
      automatic?.requestFind();
      await openConnection({ portSelection: 'choose' });
    })().catch(showError);
  };
  // A failed attempt shows as the connection's own failure; the scan reads it.
  const connectAt = (baud: number): Promise<void> =>
    openConnection({ baudRate: baud }).catch(() => undefined);
  const scan = useBaudScan(connectAt, laser.disconnect, baudRate);
  useAdoptDetectedFirmware(
    mismatch,
    laser.detectedControllerKind,
    controllerKind,
    automatic,
    reconnect,
  );
  return {
    baudRate,
    choosePort,
    connected,
    controllerKind,
    driver,
    find,
    guide,
    laser,
    mismatch,
    readAgain: () => void readController(guide, driver, laser).catch(showError),
    reconnect: () => void reconnect().catch(showError),
    disconnect: () => void laser.disconnect().catch(showError),
    scan,
    supportsSerial: platform.serial.isSupported(),
  };
}

export type FindMachineModel = ReturnType<typeof useFindMachine>;

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
// adopted it in the draft: reconnect once so the right driver reads it. Only
// after Find my machine in this setup, so a connection made elsewhere is never
// dropped by opening setup.
function useAdoptDetectedFirmware(
  mismatch: boolean,
  detected: string | null,
  draftKind: string,
  automatic: DeviceSetupAutomatic | undefined,
  reconnect: () => Promise<void>,
): void {
  const done = useRef(false);
  const adopted =
    automatic?.record?.status === 'applied' && automatic.record.summary.controllerKind !== null;
  useEffect(() => {
    if (done.current || !mismatch || !adopted || detected !== draftKind) return;
    done.current = true;
    void reconnect().catch(() => undefined);
  }, [adopted, detected, draftKind, mismatch, reconnect]);
}

function useBaudScan(
  connectAt: (baudRate: number) => Promise<void>,
  disconnect: () => Promise<void>,
  currentBaud: number,
) {
  const [status, setStatus] = useState<BaudScanStatus>({ kind: 'idle' });
  const cancelled = useRef(false);
  useEffect(() => () => void (cancelled.current = true), []);
  const start = (): void => {
    cancelled.current = false;
    const candidates = baudScanCandidates([currentBaud]);
    void scanBaudRates(
      { connectAt, disconnect, awaitAnswer, cancelled: () => cancelled.current },
      candidates,
      (baudRate, index) =>
        setStatus({ kind: 'running', baudRate, index: index + 1, of: candidates.length }),
    )
      .then((result) => {
        if (cancelled.current) return;
        setStatus(
          result.kind === 'none' ? { kind: 'none', tried: result.tried } : { kind: 'idle' },
        );
      })
      .catch(() => setStatus({ kind: 'idle' }));
  };
  const stop = (): void => {
    cancelled.current = true;
    setStatus({ kind: 'idle' });
  };
  return { status, start, stop };
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
