// A SerialPort stand-in that follows the Web Serial spec
// (https://serial.spec.whatwg.org/) and Chromium's serial_port.cc, for the
// transport tests that must see how the port itself behaves, not just the
// bytes:
// - a UART line error errors the readable and clears it, leaving the port open
//   with a fresh readable on the next read of `port.readable`;
// - a cable pull is fatal for reading and fires the port's `disconnect` event;
// - open() throws "The port is already open." while the port is open;
// - close() fails while either stream is locked, and aborts the writable;
// - the writable's sink sends each accepted chunk after a delay, drains on
//   close(), and discards what it has not sent on abort() (Chromium's
//   SerialPortUnderlyingSink: close → Drain, abort → Flush(kTransmit)).

export const SERIAL_DOUBLE_TX_DELAY_MS = 5;

export class SerialPortDouble extends EventTarget {
  opened = false;
  readFatal = false;
  streamsCreated = 0;
  /** When set, every fresh readable fails with this error before any byte. */
  failFreshStreams: string | null = null;
  readonly transmitted: string[] = [];
  readonly flushed: string[] = [];
  private currentReadable: ReadableStream<Uint8Array> | null = null;
  private currentWritable: WritableStream<Uint8Array> | null = null;
  private readController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private unread: Uint8Array[] = [];

  get readable(): ReadableStream<Uint8Array> | null {
    if (this.currentReadable !== null) return this.currentReadable;
    if (!this.opened || this.readFatal) return null;
    this.streamsCreated += 1;
    const stream: ReadableStream<Uint8Array> = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.readController = controller;
        for (const chunk of this.unread.splice(0)) controller.enqueue(chunk);
        const failure = this.failFreshStreams;
        if (failure !== null) setTimeout(() => this.readError(failure), 0);
      },
      cancel: () => this.dropReadable(stream),
    });
    this.currentReadable = stream;
    return stream;
  }

  get writable(): WritableStream<Uint8Array> | null {
    if (this.currentWritable !== null) return this.currentWritable;
    if (!this.opened) return null;
    const stream = this.slowSink(() => {
      if (this.currentWritable === stream) this.currentWritable = null;
    });
    this.currentWritable = stream;
    return stream;
  }

  async open(): Promise<void> {
    if (this.opened) {
      throw new DOMException(
        "Failed to execute 'open' on 'SerialPort': The port is already open.",
        'InvalidStateError',
      );
    }
    this.opened = true;
    this.readFatal = false;
  }

  async close(): Promise<void> {
    if (!this.opened) throw new DOMException('The port is already closed.', 'InvalidStateError');
    const readable = this.currentReadable;
    const writable = this.currentWritable;
    if (readable?.locked === true) throw new TypeError('Cannot cancel a locked stream');
    if (writable?.locked === true) throw new TypeError('Cannot abort a locked stream');
    await Promise.all([readable?.cancel(), writable?.abort()]);
    this.opened = false;
  }

  getInfo(): { usbVendorId: number; usbProductId: number } {
    return { usbVendorId: 0x1a86, usbProductId: 0x7523 };
  }

  async forget(): Promise<void> {
    this.opened = false;
  }

  /** The controller sends bytes; the OS buffers them while no stream exists. */
  emit(text: string): void {
    const bytes = new TextEncoder().encode(text);
    if (this.readController === null) this.unread.push(bytes);
    else this.readController.enqueue(bytes);
  }

  /** A UART receive error: the stream errors, the port stays open. */
  readError(name: string): void {
    const controller = this.readController;
    this.readController = null;
    this.currentReadable = null;
    controller?.error(new DOMException(`${name} (simulated)`, name));
  }

  /** A cable pull: fatal for reading, and the port's `disconnect` event. */
  unplug(): void {
    this.readFatal = true;
    this.readError('NetworkError');
    this.dispatchEvent(new Event('disconnect'));
  }

  private dropReadable(stream: ReadableStream<Uint8Array>): void {
    if (this.currentReadable !== stream) return;
    this.currentReadable = null;
    this.readController = null;
  }

  private slowSink(onEnd: () => void): WritableStream<Uint8Array> {
    const pending: string[] = [];
    let sending: ReturnType<typeof setTimeout> | null = null;
    let drained: (() => void) | null = null;
    const sendNext = (): void => {
      if (sending !== null) return;
      if (pending.length === 0) {
        drained?.();
        return;
      }
      sending = setTimeout(() => {
        sending = null;
        this.transmitted.push(pending.shift() ?? '');
        sendNext();
      }, SERIAL_DOUBLE_TX_DELAY_MS);
    };
    return new WritableStream<Uint8Array>({
      write: (chunk) => {
        pending.push(new TextDecoder().decode(chunk));
        sendNext();
      },
      close: async () => {
        await new Promise<void>((resolve) => {
          drained = resolve;
          sendNext();
        });
        onEnd();
      },
      abort: () => {
        if (sending !== null) clearTimeout(sending);
        this.flushed.push(...pending.splice(0));
        onEnd();
      },
    });
  }
}

/** Polls with real timers; the transports under test run on real streams. */
export async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let waited = 0; !predicate(); waited += 5) {
    if (waited > 3_000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
