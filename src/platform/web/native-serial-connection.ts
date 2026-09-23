import type { SerialConnection, SerialPortIdentity } from '../types';
import {
  createWorkerSerialConnection,
  WORKER_HANDSHAKE_TIMEOUT_MS,
} from './worker-serial-connection';
import { isSerialWorkerResponse } from './serial-worker-protocol';
import type {
  NativeSerialWorkerRequest,
  NativeSerialWorkerResponse,
} from './native-serial-worker-protocol';

type NativeWorker = Pick<
  Worker,
  'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>;
type Reply = (message: NativeSerialWorkerResponse) => void;

/** The picker stays on the window. The native port, its source/sink algorithms
 * and refill must all originate inside the worker to survive a stalled window.
 * A transferred window stream alone does not provide that independence. */
export async function tryOpenNativeSerialConnection(args: {
  readonly port: SerialPort;
  readonly options: SerialOptions;
  readonly serial?: Pick<Serial, 'getPorts'>;
  readonly createWorker?: () => NativeWorker;
  readonly timeoutMs?: number;
}): Promise<SerialConnection | null> {
  const serial = args.serial ?? navigator.serial;
  const timeoutMs = args.timeoutMs ?? WORKER_HANDSHAKE_TIMEOUT_MS;
  const identity = await uniqueSelectedIdentity(serial, args.port, timeoutMs);
  if (identity === null) return null;
  let worker: NativeWorker;
  try {
    worker =
      args.createWorker?.() ??
      new Worker(new URL('./native-serial-stream-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  const bridge = createNativeBridge(worker);
  let openSent = false;
  try {
    const ready = await waitForReply(bridge, { kind: 'native-probe', id: 1, identity }, timeoutMs);
    if (
      ready.kind !== 'native-ready' ||
      (await uniqueSelectedIdentity(serial, args.port, timeoutMs, identity)) === null
    ) {
      bridge.terminate();
      return null;
    }
    // From here a delayed reply cannot prove the worker did not open the port.
    // Never fall back to a second owner after requesting native ownership.
    openSent = true;
    const opened = await waitForReply(
      bridge,
      { kind: 'native-open', id: 1, options: args.options },
      timeoutMs,
    );
    requireNativeOpen(opened);
    return openedConnection(bridge, args.port, timeoutMs);
  } catch (error) {
    bridge.terminate();
    if (openSent) throw error;
    return null;
  }
}

function requireNativeOpen(message: NativeSerialWorkerResponse): void {
  if (message.kind === 'native-opened') return;
  throw new Error(
    message.kind === 'native-open-error'
      ? message.message
      : 'Serial worker did not open the selected port.',
  );
}

function openedConnection(
  bridge: NativeBridge,
  port: SerialPort,
  timeoutMs: number,
): SerialConnection {
  return createWorkerSerialConnection({
    bridge: {
      postMessage: (message) => {
        if (message.kind === 'attach')
          throw new Error('Native serial streams stay in their worker.');
        bridge.post(message);
      },
      onMessage: (handler) =>
        bridge.subscribe((message) => {
          if (isSerialWorkerResponse(message)) handler(message);
        }),
      onError: bridge.onError,
      onClosing: (handler) =>
        bridge.subscribe((message) => {
          if (message.kind === 'native-closing') handler();
        }),
      terminate: bridge.terminate,
    },
    // The worker closes its own native port before acknowledging close. The
    // original picker handle remains the exact authority for Forget only.
    port: {
      readable: null,
      writable: null,
      close: async () => undefined,
      forget: async () => port.forget?.(),
    },
    timeoutMs,
    start: () => bridge.post({ kind: 'native-start' }),
  });
}

async function uniqueSelectedIdentity(
  serial: Pick<Serial, 'getPorts'>,
  selected: SerialPort,
  timeoutMs: number,
  expected?: SerialPortIdentity,
): Promise<SerialPortIdentity | null> {
  try {
    const identity = selected.getInfo();
    if (!validUsbId(identity.usbVendorId) || !validUsbId(identity.usbProductId)) return null;
    if (
      expected !== undefined &&
      (identity.usbVendorId !== expected.usbVendorId ||
        identity.usbProductId !== expected.usbProductId)
    )
      return null;
    const matches = (await grantedPortsWithin(serial, timeoutMs)).filter((port) => {
      const info = port.getInfo();
      return (
        info.usbVendorId === identity.usbVendorId && info.usbProductId === identity.usbProductId
      );
    });
    return matches.length === 1 && matches[0] === selected ? identity : null;
  } catch {
    return null;
  }
}

function grantedPortsWithin(
  serial: Pick<Serial, 'getPorts'>,
  timeoutMs: number,
): Promise<SerialPort[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve([]), timeoutMs);
    void Promise.resolve()
      .then(() => serial.getPorts())
      .then(
        (ports) => {
          clearTimeout(timer);
          resolve(ports);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
  });
}

function validUsbId(value: number | undefined): boolean {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

type NativeBridge = ReturnType<typeof createNativeBridge>;

function createNativeBridge(worker: NativeWorker) {
  const replies = new Set<Reply>();
  const errors = new Set<() => void>();
  let failed = false;
  let terminated = false;
  worker.onmessage = (event: MessageEvent<NativeSerialWorkerResponse>) => {
    for (const reply of replies) reply(event.data);
  };
  const fail = (): void => {
    failed = true;
    for (const error of errors) error();
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;
  return {
    post: (request: NativeSerialWorkerRequest): void => {
      if (failed || terminated) throw new Error('Serial worker is unavailable.');
      worker.postMessage(request);
    },
    subscribe: (reply: Reply): (() => void) => {
      replies.add(reply);
      return () => replies.delete(reply);
    },
    onError: (error: () => void): (() => void) => {
      errors.add(error);
      if (failed) error();
      return () => errors.delete(error);
    },
    terminate: (): void => {
      if (terminated) return;
      terminated = true;
      worker.terminate();
      replies.clear();
      errors.clear();
    },
  };
}

function waitForReply(
  bridge: NativeBridge,
  request: Extract<NativeSerialWorkerRequest, { kind: 'native-probe' | 'native-open' }>,
  timeoutMs: number,
): Promise<NativeSerialWorkerResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = (): void => undefined;
    let unsubscribeError = (): void => undefined;
    const finish = (message?: NativeSerialWorkerResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      unsubscribeError();
      if (message === undefined)
        reject(new Error('Serial worker did not respond. Reconnect the controller.'));
      else resolve(message);
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    unsubscribe = bridge.subscribe((message) => {
      if (!('id' in message) || message.id !== request.id) return;
      const matches =
        request.kind === 'native-probe'
          ? message.kind === 'native-ready' || message.kind === 'native-unavailable'
          : message.kind === 'native-opened' || message.kind === 'native-open-error';
      if (matches) finish(message);
    });
    unsubscribeError = bridge.onError(() => finish());
    if (settled) {
      unsubscribeError();
      return;
    }
    try {
      bridge.post(request);
    } catch {
      finish();
    }
  });
}
