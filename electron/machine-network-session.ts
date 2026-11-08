import type { Socket } from 'node:net';
import { MachineTelnetCodec, encodeMachineTelnet } from './machine-network-telnet.js';
import type { MachineNetworkProtocol } from './machine-network-protocol.js';

const RX_LIMIT = 512 * 1024;
const WRITE_QUEUE_LIMIT = 512 * 1024;
const WRITE_LIMIT = 64 * 1024;
// Both channels reach a GRBL-family controller (grblHAL raw TCP, FluidNC
// Telnet), whose stop is the realtime reset; M5 and M9 follow it, as
// Disconnect sends them (laser-disconnect-stop.ts).
const RESET = Buffer.from([0x18]);
const STOP_LINES = Buffer.from('M5\nM9\n');
// The reset clears the controller's receive buffer, so M5 and M9 wait for its
// restart banner, for at most the store's banner wait (laser-reset-cleanup.ts).
const STOP_BANNER_WAIT_MS = 500;
const STOP_WRITE_WAIT_MS = 500;
// After the stop the socket ends gracefully, so the controller reads the stop
// before the connection goes; a peer that never closes is destroyed after this.
const STOP_CLOSE_WAIT_MS = 1_000;
type ReadResult = { readonly data: string; readonly closed: boolean; readonly error?: string };

export class MachineNetworkSession {
  private readonly codec: MachineTelnetCodec | null;
  private readonly chunks: Buffer[] = [];
  private queuedBytes = 0;
  private nextWrite = 1;
  private closed = false;
  private failure: string | undefined;
  private stopping: Promise<void> | null = null;
  private stopReceive: ((chunk: Buffer) => void) | null = null;
  private waiting: {
    readonly resolve: (result: ReadResult) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  } | null = null;
  constructor(
    private readonly socket: Socket,
    protocol: MachineNetworkProtocol = 'fluidnc-telnet',
  ) {
    this.codec = protocol === 'fluidnc-telnet' ? new MachineTelnetCodec() : null;
    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('error', () =>
      this.close('Network transport failed; command delivery may be uncertain.'),
    );
    socket.on('close', () => this.close('Network connection closed. No commands were replayed.'));
  }
  private receive(chunk: Buffer): void {
    if (this.closed) {
      this.stopReceive?.(chunk);
      return;
    }
    try {
      const decoded = this.codec?.decode(chunk) ?? { data: chunk, reply: Buffer.alloc(0) };
      if (decoded.reply.length > 0) {
        if (!this.canQueue(decoded.reply)) return;
        this.socket.write(decoded.reply);
      }
      if (decoded.data.length > 0) {
        this.queuedBytes += decoded.data.length;
        this.chunks.push(decoded.data);
      }
      if (this.queuedBytes > RX_LIMIT) {
        void this.stopAndClose(
          'Network receive queue exceeded its limit; the session was closed without dropping acknowledgements into a live stream.',
          { discardReceived: true },
        );
        return;
      }
      this.deliver();
    } catch {
      void this.stopAndClose('Invalid Telnet framing; the network session was closed.');
    }
  }
  read(): Promise<ReadResult> {
    if (this.closed || this.queuedBytes > 0) return Promise.resolve(this.take());
    if (this.waiting !== null)
      return Promise.reject(new Error('A network read is already pending.'));
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        resolve(this.take());
      }, 1000);
      this.waiting = { resolve, timer };
    });
  }
  async write(sequence: number, encoded: string): Promise<void> {
    if (this.closed) throw new Error('Network session is closed.');
    if (sequence !== this.nextWrite) {
      void this.stopAndClose('Out-of-order or repeated network write. Nothing was replayed.');
      throw new Error('Network write sequence was not accepted.');
    }
    const data = validPayload(encoded);
    const wireData = this.codec === null ? data : encodeMachineTelnet(data);
    this.nextWrite += 1;
    if (!this.canQueue(wireData)) {
      throw new Error('Network write queue exceeded its local limit.');
    }
    await new Promise<void>((resolve, reject) => {
      this.socket.write(wireData, (error?: Error | null) => {
        if (error != null) {
          this.close('Network write failed; delivery may be uncertain.');
          reject(new Error('Network write failed; delivery may be uncertain.'));
        } else if (this.closed)
          reject(new Error('Network session closed during write; delivery may be uncertain.'));
        else resolve();
      });
    });
  }
  private canQueue(data: Buffer): boolean {
    if (this.socket.writableLength + data.length <= WRITE_QUEUE_LIMIT) return true;
    this.close('Network write queue exceeded its local limit.');
    return false;
  }
  // Bytes the controller sent before closing (a final ALARM or error line) stay
  // queued for the last read; only an oversized receive queue is discarded.
  close(error?: string, options: { readonly discardReceived?: boolean } = {}): void {
    if (!this.end(error, options)) return;
    this.socket.destroy();
  }
  /**
   * Closes the session with the stop Disconnect sends, for a close no window
   * stop precedes: a crashed or silent window, the app quitting, a refused
   * write (rolling audit v11 W3-P1-1). Closing the socket stops nothing, and
   * under M3 the controller keeps the beam lit after its last move. The reset
   * goes at once; `immediate` sends M5 and M9 with it, for a process about to
   * exit, rather than after the restart banner. A session already closed sends
   * nothing; its socket is gone.
   */
  stopAndClose(
    error?: string,
    options: { readonly discardReceived?: boolean; readonly immediate?: boolean } = {},
  ): Promise<void> {
    if (!this.end(error, options)) return this.stopping ?? Promise.resolve();
    this.stopping = this.sendStop(options.immediate === true).finally(() => {
      this.stopReceive = null;
      this.socket.destroy();
    });
    return this.stopping;
  }
  /** Resolves once a stop this session sent has gone out or given up. */
  settled(): Promise<void> {
    return this.stopping ?? Promise.resolve();
  }
  // The window sees the session closed at once; the socket may still carry a stop.
  private end(error: string | undefined, options: { readonly discardReceived?: boolean }): boolean {
    if (this.closed) return false;
    this.closed = true;
    this.failure = error;
    if (options.discardReceived === true) {
      this.chunks.length = 0;
      this.queuedBytes = 0;
    }
    this.deliver();
    return true;
  }
  private async sendStop(immediate: boolean): Promise<void> {
    if (this.socket.destroyed) return;
    if (immediate) {
      // Written and ended synchronously, so both reach the OS before the process exits.
      this.socket.write(this.wire(Buffer.concat([RESET, STOP_LINES])));
    } else {
      const restarted = this.awaitRestartBanner();
      if (!(await this.writeStop(RESET))) return;
      await restarted;
      if (!(await this.writeStop(STOP_LINES))) return;
    }
    // Destroying at once would reset the connection, and a TCP reset can make
    // the controller's side drop bytes it has not read yet.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, STOP_CLOSE_WAIT_MS);
      timer.unref();
      this.socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.end();
    });
  }
  private awaitRestartBanner(): Promise<void> {
    return new Promise((resolve) => {
      let text = '';
      const timer = setTimeout(resolve, STOP_BANNER_WAIT_MS);
      this.stopReceive = (chunk) => {
        // GRBL's, grblHAL's and FluidNC's banners all start with "Grbl".
        text = (text + chunk.toString('latin1')).slice(-256);
        if (!/grbl/i.test(text)) return;
        clearTimeout(timer);
        resolve();
      };
    });
  }
  private writeStop(data: Buffer): Promise<boolean> {
    if (this.socket.destroyed) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), STOP_WRITE_WAIT_MS);
      this.socket.write(this.wire(data), (error?: Error | null) => {
        clearTimeout(timer);
        resolve(error == null);
      });
    });
  }
  private wire(data: Buffer): Buffer {
    return this.codec === null ? data : encodeMachineTelnet(data);
  }
  private take(): ReadResult {
    const data = Buffer.concat(this.chunks, this.queuedBytes).toString('base64');
    this.chunks.length = 0;
    this.queuedBytes = 0;
    return {
      data,
      closed: this.closed,
      ...(this.failure === undefined ? {} : { error: this.failure }),
    };
  }
  private deliver(): void {
    const pending = this.waiting;
    if (pending === null || (!this.closed && this.queuedBytes === 0)) return;
    this.waiting = null;
    clearTimeout(pending.timer);
    pending.resolve(this.take());
  }
}

function validPayload(encoded: string): Buffer {
  if (
    encoded.length > Math.ceil(WRITE_LIMIT / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  )
    throw new Error('Invalid network write payload.');
  const data = Buffer.from(encoded, 'base64');
  if (data.length === 0 || data.length > WRITE_LIMIT || data.toString('base64') !== encoded)
    throw new Error('Invalid network write payload.');
  return data;
}
