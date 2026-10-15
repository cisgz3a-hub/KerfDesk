// Worker handshakes have a deadline; actual transferred-stream cleanup must
// retain ownership until both locks are released. The connection separately
// bounds each caller's wait without claiming that cleanup finished (ADR-600).

type PortStreams = {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
};

// How often teardown looks again for the port's streams to come free. There is
// no event for a stream being unlocked, and the drain it waits on is the
// serial sink sending a few short lines.
const PORT_RELEASE_POLL_MS = 10;

/** Run `begin`, then resolve on its callback or on the deadline — whichever
 * comes first. Never rejects: a silent worker is handled by the caller's own
 * fallback, not by an unhandled rejection on a teardown path. */
export async function settleWithin(
  timeoutMs: number,
  begin: (done: () => void) => void,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    begin(finish);
  });
}

// The worker closing its writer only posts the close across the transfer: the
// port's own writable is still sending what Disconnect queued last (the
// driver's M5/M9) until its sink drains, and the transfer pipe holds the lock
// until then. Closing the port while it is locked fails and leaves the port
// open; aborting the sink instead discards those bytes, since Chromium
// implements abort as a transmit-buffer flush (serial_port_underlying_sink.cc).
// Wait for the actual release. A caller timeout is handled by
// boundedSerialClose; it must not turn a still-locked port into a new owner.
export async function portStreamsReleased(port: PortStreams): Promise<void> {
  while (portStreamLocked(port)) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, PORT_RELEASE_POLL_MS);
    });
  }
}

function portStreamLocked(port: PortStreams): boolean {
  return port.readable?.locked === true || port.writable?.locked === true;
}
