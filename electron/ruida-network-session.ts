import type { RemoteInfo, Socket } from 'node:dgram';
import { RUIDA_MAX_DATAGRAM_BYTES } from './ruida-network-wire.js';

// One Ruida UDP session in the main process (ADR-697): a bound socket that
// sends the window's datagrams to the controller and queues the controller's
// replies for the window's reads. Like the TCP sessions (machine-network-
// session.ts) it never replays a write: a repeated or out-of-order sequence
// closes it. It only accepts datagrams from the controller's own address and
// port, so another host on the network cannot answer for it.

// The controller speaks only when spoken to (meerk40t ruidasession.py
// _ruida_handshaker), one datagram at a time, so a few replies queue at most;
// a flood from the controller's address is a fault, not a reply stream.
const RX_DATAGRAM_LIMIT = 256;
const READ_WAIT_MS = 1_000;
const STOP_SEND_WAIT_MS = 500;
type ReadResult = {
  readonly datagrams: ReadonlyArray<string>;
  readonly closed: boolean;
  readonly error?: string;
};

export type RuidaSessionTarget = {
  readonly host: string;
  readonly port: number;
  /** Stop Process, framed for this controller's swizzle magic. */
  readonly stopDatagram: Buffer;
};

export class RuidaNetworkSession {
  private readonly received: Buffer[] = [];
  private nextWrite = 1;
  private closed = false;
  private failure: string | undefined;
  private stopping: Promise<void> | null = null;
  private stopSent: Promise<boolean> | null = null;
  private waiting: {
    readonly resolve: (result: ReadResult) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  } | null = null;
  constructor(
    private readonly socket: Socket,
    private readonly target: RuidaSessionTarget,
  ) {
    socket.on('message', (datagram: Buffer, from: RemoteInfo) => this.receive(datagram, from));
    socket.on('error', () =>
      this.close('UDP transport failed; command delivery may be uncertain.'),
    );
    socket.on('close', () => this.close('The UDP socket closed. No commands were replayed.'));
  }
  private receive(datagram: Buffer, from: RemoteInfo): void {
    if (this.closed || from.address !== this.target.host || from.port !== this.target.port) return;
    if (this.received.length >= RX_DATAGRAM_LIMIT) {
      void this.stopAndClose('The controller sent more replies than were asked for; closed.');
      return;
    }
    this.received.push(Buffer.from(datagram));
    this.deliver();
  }
  read(): Promise<ReadResult> {
    if (this.closed || this.received.length > 0) return Promise.resolve(this.take());
    if (this.waiting !== null) return Promise.reject(new Error('A Ruida read is already pending.'));
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        resolve(this.take());
      }, READ_WAIT_MS);
      this.waiting = { resolve, timer };
    });
  }
  async write(sequence: number, encoded: string): Promise<void> {
    if (this.closed) throw new Error('Ruida network session is closed.');
    if (sequence !== this.nextWrite) {
      void this.stopAndClose('Out-of-order or repeated Ruida datagram. Nothing was replayed.');
      throw new Error('Ruida datagram sequence was not accepted.');
    }
    const datagram = validDatagram(encoded);
    this.nextWrite += 1;
    await new Promise<void>((resolve, reject) => {
      this.socket.send(datagram, this.target.port, this.target.host, (error) => {
        if (error != null) {
          this.close('Ruida datagram send failed; delivery may be uncertain.');
          reject(new Error('Ruida datagram send failed; delivery may be uncertain.'));
        } else if (this.closed)
          reject(new Error('Ruida session closed during a send; delivery may be uncertain.'));
        else resolve();
      });
    });
  }
  close(error?: string): void {
    if (!this.end(error)) return;
    this.closeSocket();
  }
  /**
   * Closes the session with Stop Process, for a close no window stop precedes:
   * a crashed or silent window, the app quitting, a refused write. A Ruida runs
   * the job from its own memory, so closing the socket stops nothing. Resolves
   * true only when the OS took the datagram; UDP gives no proof it arrived.
   */
  stopAndClose(error?: string): Promise<boolean> {
    if (!this.end(error)) return this.stopSent ?? Promise.resolve(false);
    this.stopSent = this.sendStop();
    this.stopping = this.stopSent.then(() => this.closeSocket());
    return this.stopSent;
  }
  /** Resolves once a stop this session sent has gone out or given up. */
  settled(): Promise<void> {
    return this.stopping ?? Promise.resolve();
  }
  private sendStop(): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), STOP_SEND_WAIT_MS);
      timer.unref();
      try {
        this.socket.send(this.target.stopDatagram, this.target.port, this.target.host, (error) => {
          clearTimeout(timer);
          resolve(error == null);
        });
      } catch {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }
  private closeSocket(): void {
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
  }
  // The window sees the session closed at once; the socket may still carry a stop.
  private end(error: string | undefined): boolean {
    if (this.closed) return false;
    this.closed = true;
    this.failure = error;
    this.deliver();
    return true;
  }
  private take(): ReadResult {
    const datagrams = this.received.splice(0).map((datagram) => datagram.toString('base64'));
    return {
      datagrams,
      closed: this.closed,
      ...(this.failure === undefined ? {} : { error: this.failure }),
    };
  }
  private deliver(): void {
    const pending = this.waiting;
    if (pending === null || (!this.closed && this.received.length === 0)) return;
    this.waiting = null;
    clearTimeout(pending.timer);
    pending.resolve(this.take());
  }
}

function validDatagram(encoded: string): Buffer {
  if (
    encoded.length > Math.ceil(RUIDA_MAX_DATAGRAM_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  )
    throw new Error('Invalid Ruida datagram.');
  const datagram = Buffer.from(encoded, 'base64');
  if (
    datagram.length < 3 ||
    datagram.length > RUIDA_MAX_DATAGRAM_BYTES ||
    datagram.toString('base64') !== encoded
  )
    throw new Error('Invalid Ruida datagram.');
  return datagram;
}
