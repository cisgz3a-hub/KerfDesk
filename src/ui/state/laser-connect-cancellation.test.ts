import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControllerKind } from '../../core/devices';
import type { PlatformAdapter, SerialConnection, SerialPortRef } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { rememberSerialPort } from './serial-port-memory';
import { installAutoConnect } from '../app/use-auto-connect-controller';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function adapterFor(serial: PlatformAdapter['serial']): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial,
  };
}

function connection(): SerialConnection {
  return {
    write: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
    onLine: vi.fn(() => () => undefined),
    onClose: vi.fn(() => () => undefined),
  };
}

beforeEach(() => {
  localStorage.clear();
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  localStorage.clear();
});

const LIVE_CONTROLLERS: readonly ControllerKind[] = [
  'grbl-v1.1',
  'grblhal',
  'fluidnc',
  'marlin',
  'smoothieware',
];

describe('Disconnect cancels an unfinished connection', () => {
  it.each(LIVE_CONTROLLERS)(
    'returns %s to disconnected immediately while its picker is pending',
    async (controllerKind) => {
      const picker = deferred<SerialPortRef | null>();
      const lateConnection = connection();
      const open = vi.fn(async () => lateConnection);
      const forget = vi.fn(async () => undefined);
      const requestPort = vi.fn(() => picker.promise);
      const connecting = useLaserStore
        .getState()
        .connect(adapterFor({ isSupported: () => true, requestPort }), { controllerKind });
      await vi.waitFor(() => expect(requestPort).toHaveBeenCalledOnce());

      await useLaserStore.getState().disconnect();
      expect(useLaserStore.getState().connection.kind).toBe('disconnected');
      expect(useLaserStore.getState().controllerQualification.kind).toBe('disconnected');

      picker.resolve({ open, forget });
      await connecting;
      expect(open).not.toHaveBeenCalled();
      expect(forget).not.toHaveBeenCalled();
      expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    },
  );

  it.each(LIVE_CONTROLLERS)(
    'closes a late %s open without attaching it or forgetting permission',
    async (controllerKind) => {
      const opening = deferred<SerialConnection>();
      const lateConnection = connection();
      const open = vi.fn(() => opening.promise);
      const connecting = useLaserStore
        .getState()
        .connect(adapterFor({ isSupported: () => true, requestPort: async () => ({ open }) }), {
          controllerKind,
        });
      await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());

      await useLaserStore.getState().disconnect();
      expect(useLaserStore.getState().connection.kind).toBe('disconnected');

      opening.resolve(lateConnection);
      await connecting;
      expect(lateConnection.close).toHaveBeenCalledOnce();
      expect(lateConnection.forget).not.toHaveBeenCalled();
      expect(lateConnection.onLine).not.toHaveBeenCalled();
      expect(lateConnection.write).not.toHaveBeenCalled();
      expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    },
  );

  it('does not show a late picker after Disconnect cancels permission discovery', async () => {
    const grants = deferred<ReadonlyArray<SerialPortRef>>();
    const grantedPorts = vi.fn(() => grants.promise);
    const requestPort = vi.fn(async () => null);
    const connecting = useLaserStore
      .getState()
      .connect(adapterFor({ isSupported: () => true, grantedPorts, requestPort }));
    await vi.waitFor(() => expect(grantedPorts).toHaveBeenCalledOnce());

    await useLaserStore.getState().disconnect();
    grants.resolve([]);
    await connecting;

    expect(requestPort).not.toHaveBeenCalled();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
  });

  it('leaves a newer attempt in charge when the cancelled open finishes', async () => {
    const opening = deferred<SerialConnection>();
    const lateConnection = connection();
    const open = vi.fn(() => opening.promise);
    const first = useLaserStore
      .getState()
      .connect(adapterFor({ isSupported: () => true, requestPort: async () => ({ open }) }));
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    await useLaserStore.getState().disconnect();

    const nextPicker = deferred<SerialPortRef | null>();
    const nextRequest = vi.fn(() => nextPicker.promise);
    const next = useLaserStore
      .getState()
      .connect(adapterFor({ isSupported: () => true, requestPort: nextRequest }));
    await vi.waitFor(() => expect(nextRequest).toHaveBeenCalledOnce());
    const newerState = useLaserStore.getState();

    opening.resolve(lateConnection);
    await first;
    expect(lateConnection.close).toHaveBeenCalledOnce();
    expect(useLaserStore.getState()).toBe(newerState);

    nextPicker.resolve(null);
    await next;
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
  });
});

type GrantScenario =
  | 'single'
  | 'remembered match'
  | 'none'
  | 'unmatched'
  | 'ambiguous'
  | 'ordinary cancel';

function grantScenario(scenario: GrantScenario) {
  const wanted = { usbVendorId: 1, usbProductId: 2 };
  const other = { usbVendorId: 3, usbProductId: 4 };
  const open = vi.fn(async () => connection());
  let available: SerialPortRef[] = [];
  const makePort = (info: typeof wanted) => {
    const port: SerialPortRef = {
      info,
      open,
      forget: vi.fn(async () => {
        available = available.filter((candidate) => candidate !== port);
      }),
    };
    return port;
  };
  const selected = makePort(wanted);
  const unrelated = makePort(other);
  if (scenario === 'single' || scenario === 'ordinary cancel') available = [selected];
  if (scenario === 'remembered match') available = [unrelated, selected];
  if (scenario === 'unmatched') available = [unrelated, makePort(other)];
  if (scenario === 'ambiguous') available = [selected, makePort(wanted)];
  if (scenario !== 'single' && scenario !== 'ordinary cancel')
    rememberSerialPort(localStorage, wanted);
  return { selected, allGrants: [...available], open, available: () => available, other };
}

describe('Forget during granted-port discovery', () => {
  it.each([
    'single',
    'remembered match',
    'none',
    'unmatched',
    'ambiguous',
    'ordinary cancel',
  ] as const)('retires only the intended grant: %s', async (scenario) => {
    const grants = deferred<ReadonlyArray<SerialPortRef>>();
    const { selected, allGrants, open, available, other } = grantScenario(scenario);
    const grantedPorts = vi
      .fn(async (): Promise<ReadonlyArray<SerialPortRef>> => available())
      .mockImplementationOnce(() => grants.promise);
    const requestPort = vi.fn(async () => null);
    const adapter = adapterFor({ isSupported: () => true, grantedPorts, requestPort });
    const connecting = useLaserStore.getState().connect(adapter);
    await vi.waitFor(() => expect(grantedPorts).toHaveBeenCalledOnce());
    if (scenario === 'ordinary cancel') await useLaserStore.getState().disconnect();
    else await useLaserStore.getState().forgetDevice?.();
    // A newer remembered identity must not retarget the forgotten attempt.
    if (scenario === 'remembered match') rememberSerialPort(localStorage, other);
    grants.resolve(available());
    await connecting;
    const shouldForget = scenario === 'single' || scenario === 'remembered match';
    expect(selected.forget).toHaveBeenCalledTimes(shouldForget ? 1 : 0);
    for (const grant of allGrants) {
      if (grant !== selected) expect(grant.forget).not.toHaveBeenCalled();
    }
    expect(open).not.toHaveBeenCalled();
    expect(requestPort).not.toHaveBeenCalled();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    if (scenario === 'single') {
      await useLaserStore.getState().connect(adapter);
      expect(requestPort).toHaveBeenCalledOnce();
      expect(open).not.toHaveBeenCalled();
    }
  });

  it('leaves a newer picker attempt untouched when the forgotten grant lookup completes', async () => {
    const grants = deferred<ReadonlyArray<SerialPortRef>>();
    const grantedPorts = vi.fn(() => grants.promise);
    const forget = vi.fn(async () => undefined);
    const open = vi.fn(async () => connection());
    const first = useLaserStore.getState().connect(
      adapterFor({
        isSupported: () => true,
        grantedPorts,
        requestPort: async () => null,
      }),
    );
    await vi.waitFor(() => expect(grantedPorts).toHaveBeenCalledOnce());
    await useLaserStore.getState().forgetDevice?.();
    const picker = deferred<SerialPortRef | null>();
    const requestPort = vi.fn(() => picker.promise);
    const next = useLaserStore
      .getState()
      .connect(adapterFor({ isSupported: () => true, requestPort }));
    const newerAttempt = useLaserStore.getState().connectionAttempt;
    expect(requestPort).not.toHaveBeenCalled();
    grants.resolve([{ open, forget }]);
    await first;
    await vi.waitFor(() => expect(requestPort).toHaveBeenCalledOnce());
    expect(forget).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(useLaserStore.getState().connectionAttempt).toBe(newerAttempt);
    expect(useLaserStore.getState().connection.kind).toBe('connecting');
    picker.resolve(null);
    await next;
  });
  it.each(['replace', 'cancel'] as const)(
    'finishes forgotten grant cleanup before a newer same-device choice: %s',
    async (nextAction) => {
      const grants = deferred<ReadonlyArray<SerialPortRef>>();
      const revocation = deferred<undefined>();
      const grantedPorts = vi.fn(() => grants.promise);
      const events: string[] = [];
      const first = useLaserStore.getState().connect(
        adapterFor({
          isSupported: () => true,
          grantedPorts,
          requestPort: async () => null,
        }),
      );
      await vi.waitFor(() => expect(grantedPorts).toHaveBeenCalledOnce());
      await useLaserStore.getState().forgetDevice?.();
      let permitted = true;
      const forget = vi.fn(async () => {
        events.push('forget:start');
        await revocation.promise;
        permitted = false;
        events.push('forget:done');
      });
      const open = vi.fn(async () => {
        expect(permitted).toBe(true);
        events.push('open');
        return connection();
      });
      // Enumeration and picker return distinct wrappers for the same grant.
      const requestPort = vi.fn(async () => {
        permitted = true;
        events.push('picker');
        return { open };
      });
      const adapter = adapterFor({ isSupported: () => true, requestPort });
      const second = useLaserStore.getState().connect(adapter);
      const third = useLaserStore.getState().connect(adapter);
      if (nextAction === 'cancel') await useLaserStore.getState().disconnect();
      grants.resolve([{ open, forget }]);
      await vi.waitFor(() => expect(forget).toHaveBeenCalledOnce());
      try {
        expect(requestPort).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
      } finally {
        revocation.resolve(undefined);
        await Promise.all([first, second, third]);
      }
      if (nextAction === 'replace') {
        expect(events).toEqual(['forget:start', 'forget:done', 'picker', 'open']);
        expect(open).toHaveBeenCalledOnce();
        expect(permitted).toBe(true);
      } else {
        expect(events).toEqual(['forget:start', 'forget:done']);
        expect(useLaserStore.getState().connection.kind).toBe('disconnected');
      }
    },
  );
});

it('keeps a queued explicit chooser in charge when an eligible grant appears', async () => {
  const grants = deferred<ReadonlyArray<SerialPortRef>>();
  const open = vi.fn(async () => connection());
  const eligible: SerialPortRef = { open, forget: vi.fn(async () => undefined) };
  const grantedPorts = vi
    .fn(async (): Promise<ReadonlyArray<SerialPortRef>> => [eligible])
    .mockResolvedValueOnce([])
    .mockImplementationOnce(() => grants.promise);
  const requestPort = vi.fn(async () => null);
  let grantChanged: () => void = () => undefined;
  const adapter = adapterFor({
    isSupported: () => true,
    grantedPorts,
    requestPort,
    onGrantedPortsChange: (handler) => {
      grantChanged = handler;
      return () => undefined;
    },
  });
  const dispose = installAutoConnect(adapter);
  try {
    await vi.waitFor(() => expect(grantedPorts).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const original = useLaserStore.getState().connect(adapter);
    await vi.waitFor(() => expect(grantedPorts).toHaveBeenCalledTimes(2));
    await useLaserStore.getState().forgetDevice?.();
    const choosing = useLaserStore.getState().connect(adapter, { portSelection: 'choose' });
    const stateWhileQueued = useLaserStore.getState().connection.kind;
    grantChanged();
    await new Promise((resolve) => setTimeout(resolve, 0));
    grants.resolve([eligible]);
    await Promise.all([original, choosing]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stateWhileQueued).toBe('connecting');
    expect(requestPort).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(grantedPorts).toHaveBeenCalledTimes(2);
    expect(eligible.forget).toHaveBeenCalledOnce();
  } finally {
    grants.resolve([]);
    dispose();
  }
});
