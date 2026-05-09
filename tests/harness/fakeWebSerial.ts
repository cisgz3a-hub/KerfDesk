/**
 * T3-63: reusable fake WebSerial harness.
 *
 * This intentionally models the browser API boundary instead of the
 * application-level SerialPortLike contract. Tests that use this fake exercise
 * WebSerialPort's actual ReadableStream/WritableStream read loop, writer error
 * path, navigator.serial request flow, and disconnect listener wiring.
 */
import type { SimulatedControllerDevice } from '../simulators/SimulatedControllerDevice';

export interface FakeSerialPortInfo {
  readonly usbVendorId?: number;
  readonly usbProductId?: number;
}

export interface FakeSerialPortOptions {
  readonly vendorId?: number;
  readonly productId?: number;
  readonly simulator?: SimulatedControllerDevice;
}

type SerialEventName = 'connect' | 'disconnect';
type SerialEventListener = (event: Event & { port?: SerialPort }) => void;
type TimerHandle = ReturnType<typeof setTimeout>;

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function errorFrom(reason: string | Error): Error {
  return reason instanceof Error ? reason : new Error(reason);
}

export class FakeSerialPort implements SerialPort {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly writes: Uint8Array[] = [];

  openCalled = 0;
  closeCalled = 0;
  forgetCalled = 0;
  openOptions: { baudRate: number } | null = null;

  private readController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readClosed = false;
  private readErrored = false;
  private opened = false;
  private writeCount = 0;
  private rejectWriteError: Error | null = null;
  private closeAfterWriteCount: number | null = null;
  private readonly timers = new Set<TimerHandle>();
  private readonly decoder = new TextDecoder();

  constructor(private readonly options: FakeSerialPortOptions = {}) {
    this.readable = new ReadableStream<Uint8Array>({
      start: controller => {
        this.readController = controller;
      },
      cancel: () => {
        this.readClosed = true;
        this.clearTimers();
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: chunk => this.handleWrite(chunk),
      abort: () => {
        this.rejectWriteError = null;
      },
    });
  }

  async open(options: { baudRate: number }): Promise<void> {
    this.openCalled++;
    this.openOptions = options;
    this.opened = true;
  }

  async close(): Promise<void> {
    this.closeCalled++;
    this.opened = false;
    this.clearTimers();
  }

  async forget(): Promise<void> {
    this.forgetCalled++;
  }

  getInfo(): FakeSerialPortInfo {
    return {
      usbVendorId: this.options.vendorId,
      usbProductId: this.options.productId,
    };
  }

  scheduleRead(bytes: Uint8Array, atVirtualMs = 0): void {
    const chunk = cloneBytes(bytes);
    this.schedule(() => {
      if (!this.readController || this.readClosed || this.readErrored) return;
      this.readController.enqueue(chunk);
    }, atVirtualMs);
  }

  scheduleReaderError(message: string, atVirtualMs = 0): void {
    this.schedule(() => {
      if (!this.readController || this.readClosed || this.readErrored) return;
      this.readErrored = true;
      this.readController.error(new Error(message));
    }, atVirtualMs);
  }

  scheduleReaderDone(atVirtualMs = 0): void {
    this.schedule(() => {
      if (!this.readController || this.readClosed || this.readErrored) return;
      this.readClosed = true;
      this.readController.close();
    }, atVirtualMs);
  }

  rejectNextWrite(reason: string | Error): void {
    this.rejectWriteError = errorFrom(reason);
  }

  closeAfterWrites(writeCount: number): void {
    this.closeAfterWriteCount = Math.max(1, writeCount);
  }

  writesAsText(): string {
    return this.writes.map(bytes => this.decoder.decode(bytes)).join('');
  }

  private schedule(action: () => void, atVirtualMs: number): void {
    if (atVirtualMs <= 0) {
      queueMicrotask(action);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      action();
    }, atVirtualMs);
    this.timers.add(timer);
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private async handleWrite(chunk: Uint8Array): Promise<void> {
    if (!this.opened) throw new Error('Port is not open');

    const bytes = cloneBytes(chunk);
    this.writeCount++;

    if (this.rejectWriteError) {
      const error = this.rejectWriteError;
      this.rejectWriteError = null;
      throw error;
    }

    this.writes.push(bytes);

    if (this.options.simulator) {
      this.options.simulator.receiveBytes(bytes);
      for (const outgoing of this.options.simulator.readOutgoingBytes()) {
        this.scheduleRead(outgoing, 0);
      }
    }

    if (this.closeAfterWriteCount !== null && this.writeCount >= this.closeAfterWriteCount) {
      this.closeAfterWriteCount = null;
      this.scheduleReaderDone(0);
    }
  }
}

export class FakeNavigatorSerial {
  private readonly knownPorts: FakeSerialPort[] = [];
  private readonly requestQueue: FakeSerialPort[] = [];
  private readonly listeners = new Map<SerialEventName, Set<SerialEventListener>>([
    ['connect', new Set()],
    ['disconnect', new Set()],
  ]);
  private nextRequestPortError: Error | null = null;
  private previousNavigatorDescriptor: PropertyDescriptor | undefined;
  private installed = false;

  installAsGlobal(): void {
    if (!this.installed) {
      this.previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      this.installed = true;
    }

    const existingNavigator =
      typeof navigator === 'undefined' ? {} : (navigator as unknown as Record<string, unknown>);
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...existingNavigator,
        serial: this,
      },
      configurable: true,
      writable: true,
    });
  }

  removeFromGlobal(): void {
    if (!this.installed) return;

    if (this.previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', this.previousNavigatorDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'navigator');
    }

    this.installed = false;
  }

  preparePort(options: FakeSerialPortOptions = {}): FakeSerialPort {
    const port = new FakeSerialPort(options);
    this.knownPorts.push(port);
    this.requestQueue.push(port);
    return port;
  }

  rejectNextRequestPort(reason: string | Error): void {
    this.nextRequestPortError = errorFrom(reason);
  }

  async requestPort(): Promise<SerialPort> {
    if (this.nextRequestPortError) {
      const error = this.nextRequestPortError;
      this.nextRequestPortError = null;
      throw error;
    }

    return this.requestQueue.shift() ?? this.preparePort();
  }

  async getPorts(): Promise<SerialPort[]> {
    return [...this.knownPorts];
  }

  addEventListener(type: SerialEventName, listener: SerialEventListener): void {
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: SerialEventName, listener: SerialEventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchConnect(port?: FakeSerialPort): void {
    this.dispatch('connect', port);
  }

  dispatchDisconnect(port?: FakeSerialPort): void {
    this.dispatch('disconnect', port);
  }

  private dispatch(type: SerialEventName, port?: FakeSerialPort): void {
    const event = { type, port } as Event & { port?: SerialPort };
    for (const listener of Array.from(this.listeners.get(type) ?? [])) {
      listener(event);
    }
  }
}
