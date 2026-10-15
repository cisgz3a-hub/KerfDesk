// A caller may stop waiting for a wedged drain/cancel/native close without
// pretending the port has been released. Keep its actual cleanup registered
// until it settles, and refuse any new owner of that selected port meanwhile.
export const SERIAL_PORT_CLOSE_TIMEOUT_MS = 5_000;

type ClosablePort = { readonly close: () => Promise<void> };
const closingPorts = new WeakMap<ClosablePort, Promise<void>>();

export function requireSerialPortReleased(port: ClosablePort): void {
  if (closingPorts.has(port))
    throw new Error('The previous serial connection is still closing. Reconnect after it closes.');
}

export function closeSerialPort(
  port: ClosablePort,
  releaseStreams: () => Promise<void> = async () => undefined,
): Promise<void> {
  return boundedSerialClose(startSerialPortClose(port, releaseStreams));
}

/** The actual operation stays usable after any individual caller times out. */
export function startSerialPortClose(
  port: ClosablePort,
  releaseStreams: () => Promise<void>,
): Promise<void> {
  let operation = closingPorts.get(port);
  if (operation === undefined) {
    operation = Promise.resolve().then(async () => {
      await releaseStreams();
      await port.close();
    });
    closingPorts.set(port, operation);
    void operation.then(
      () => closingPorts.delete(port),
      () => closingPorts.delete(port),
    );
  }
  return operation;
}

/** A timeout is a failed close, not confirmation that outstanding bytes sent. */
export async function boundedSerialClose(operation: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Serial shutdown timed out; controller delivery is unconfirmed.')),
          SERIAL_PORT_CLOSE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
