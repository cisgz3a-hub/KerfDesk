import type { Socket } from 'node:net';
import { MachineTelnetCodec, encodeMachineTelnet } from './machine-network-telnet.js';

const RX_LIMIT = 512 * 1024;
const WRITE_LIMIT = 64 * 1024;
type ReadResult = { readonly data: string; readonly closed: boolean; readonly error?: string };

export class MachineNetworkSession {
  private readonly codec = new MachineTelnetCodec();
  private readonly chunks: Buffer[] = [];
  private queuedBytes = 0;
  private nextWrite = 1;
  private closed = false;
  private failure: string | undefined;
  private waiting: {
    readonly resolve: (result: ReadResult) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  } | null = null;
  constructor(private readonly socket: Socket) {
    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('error', () =>
      this.close('Network transport failed; command delivery may be uncertain.'),
    );
    socket.on('close', () => this.close('Network connection closed. No commands were replayed.'));
  }
  private receive(chunk: Buffer): void {
    if (this.closed) return;
    try {
      const decoded = this.codec.decode(chunk);
      if (decoded.reply.length > 0) this.socket.write(decoded.reply);
      if (decoded.data.length > 0) {
        this.queuedBytes += decoded.data.length;
        this.chunks.push(decoded.data);
      }
      if (this.queuedBytes > RX_LIMIT) {
        this.close(
          'Network receive queue exceeded its limit; the session was closed without dropping acknowledgements into a live stream.',
        );
        return;
      }
      this.deliver();
    } catch {
      this.close('Invalid Telnet framing; the network session was closed.');
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
      this.close('Out-of-order or repeated network write. Nothing was replayed.');
      throw new Error('Network write sequence was not accepted.');
    }
    const data = validPayload(encoded);
    this.nextWrite += 1;
    if (this.socket.writableLength + data.length > RX_LIMIT) {
      this.close('Network write queue exceeded its local limit.');
      throw new Error('Network write queue exceeded its local limit.');
    }
    await new Promise<void>((resolve, reject) => {
      this.socket.write(encodeMachineTelnet(data), (error?: Error | null) => {
        if (error != null) {
          this.close('Network write failed; delivery may be uncertain.');
          reject(new Error('Network write failed; delivery may be uncertain.'));
        } else if (this.closed)
          reject(new Error('Network session closed during write; delivery may be uncertain.'));
        else resolve();
      });
    });
  }
  close(error?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = error;
    this.socket.destroy();
    this.chunks.length = 0;
    this.queuedBytes = 0;
    this.deliver();
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
