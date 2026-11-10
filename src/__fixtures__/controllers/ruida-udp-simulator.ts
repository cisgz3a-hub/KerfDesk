// Scripted Ruida UDP controller (ADR-697) for tests: it answers datagrams the
// way public research says a Ruida does — one swizzled verdict byte per
// datagram, ACK 0xCC or NAK 0xCF (meerk40t rdjob.py ACK/NAK, ruidasession.py
// _ruida_handshaker), and for a DA 00 read one more datagram with DA 01
// <memory(2)> <value(5)> (rdjob.py decode_reply). Job datagrams build up a
// file that this repo's .rd decoder (ruida-decoder.ts) reads once its D7 End
// Of File arrives; the file then "runs" for a scripted number of status reads.
// D8 01/02/03 stop, pause and restore it. It proves KerfDesk keeps its side
// of that exchange; it does NOT prove a real controller behaves this way.

import {
  swizzleByte,
  unswizzleBytes,
  RUIDA_ACK,
  RUIDA_NAK,
  RUIDA_SWIZZLE_MAGIC,
} from '../../core/controllers/ruida';
import {
  encodeRuidaReply,
  RUIDA_MEM_CURRENT_X,
  RUIDA_MEM_CURRENT_Y,
  RUIDA_MEM_MACHINE_STATUS,
} from '../../core/controllers/ruida/ruida-live-commands';
import { RUIDA_ENQ } from '../../core/controllers/ruida/ruida-udp-session';
import type { RuidaDatagramLink, RuidaNetworkAdapter } from '../../platform/ruida-network-types';
import { decodeRdStream, type RdDecodedEvent } from './ruida-decoder';

/** What the controller does with one datagram. `lose-ack` takes it and loses
 *  the verdict; `drop` never receives it; `enq` sends a keepalive, then ACKs. */
export type RuidaSimVerdict = 'ack' | 'nak' | 'lose-ack' | 'drop' | 'enq';

export type RuidaSimScript = {
  /** For the n-th datagram sent to it (1-based), dropped ones included. Default: 'ack'. */
  readonly verdict?: (index: number) => RuidaSimVerdict;
  /** How many status reads a job or frame stays busy for. Default 3. */
  readonly runReads?: number;
  /** Status reads go unanswered (the read's ACK still comes). */
  readonly silentStatus?: boolean;
  /** The controller is already running something when KerfDesk connects. */
  readonly busyAtStart?: boolean;
};

export type RuidaSimControl = 'stop' | 'pause' | 'restore';

const CONTROLS = new Map<number, RuidaSimControl>([
  [0x01, 'stop'],
  [0x02, 'pause'],
  [0x03, 'restore'],
]);
const STATUS_JOB_RUNNING = 0x00000001;
const STATUS_MOVING = 0x01000000;

export class RuidaUdpSimulator {
  /** Every datagram that reached the controller, as sent. */
  readonly received: Uint8Array[] = [];
  /** Standalone process commands, in the order the controller took them. */
  readonly controls: RuidaSimControl[] = [];
  /** Every complete file it received, decoded. */
  readonly files: RdDecodedEvent[][] = [];
  /** Memory addresses read, in order. */
  readonly reads: number[] = [];
  running: boolean;
  paused = false;
  /** How many status reads the next job or frame stays busy for; 0 never reports busy. */
  runReads: number;
  private file: number[] = [];
  private remaining: number;
  private sent = 0;
  constructor(
    private readonly script: RuidaSimScript = {},
    readonly magic: number = RUIDA_SWIZZLE_MAGIC,
  ) {
    this.runReads = script.runReads ?? 3;
    this.running = script.busyAtStart === true;
    this.remaining = script.busyAtStart === true ? this.runReads : 0;
  }

  /** The datagrams the controller sends back for one it was sent. */
  receive(datagram: Uint8Array): Uint8Array[] {
    // Every datagram sent counts, dropped ones too, so a script names each once.
    this.sent += 1;
    const verdict = this.script.verdict?.(this.sent) ?? 'ack';
    if (verdict === 'drop') return [];
    this.received.push(Uint8Array.from(datagram));
    const payload = datagram.slice(2);
    if (!checksumMatches(datagram) || verdict === 'nak') return [this.byte(RUIDA_NAK)];
    const reply = this.take(payload);
    if (verdict === 'lose-ack') return [];
    const ack = this.byte(RUIDA_ACK);
    const answer = verdict === 'enq' ? [this.byte(RUIDA_ENQ), ack] : [ack];
    return reply === null ? answer : [...answer, reply];
  }

  private take(payload: Uint8Array): Uint8Array | null {
    const plain = Array.from(unswizzleBytes(payload, this.magic));
    if (plain.length === 4 && plain[0] === 0xda && plain[1] === 0x00) {
      return this.readMemory(((plain[2] ?? 0) << 8) | (plain[3] ?? 0));
    }
    const control =
      plain.length === 2 && plain[0] === 0xd8 ? CONTROLS.get(plain[1] ?? 0) : undefined;
    if (control !== undefined) {
      this.control(control);
      return null;
    }
    this.file.push(...payload);
    if (plain.at(-1) === 0xd7) this.runFile();
    return null;
  }

  private runFile(): void {
    this.files.push([...decodeRdStream(Uint8Array.from(this.file))]);
    this.file = [];
    this.running = this.runReads > 0;
    this.paused = false;
    this.remaining = this.runReads;
  }

  private control(command: RuidaSimControl): void {
    this.controls.push(command);
    if (command === 'stop') {
      this.running = false;
      this.paused = false;
      this.file = [];
    } else {
      this.paused = command === 'pause' && this.running;
    }
  }

  private readMemory(address: number): Uint8Array | null {
    this.reads.push(address);
    if (address === RUIDA_MEM_MACHINE_STATUS) {
      if (this.script.silentStatus === true) return null;
      const busy = this.running;
      if (this.running && !this.paused) {
        this.remaining -= 1;
        if (this.remaining <= 0) this.running = false;
      }
      return encodeRuidaReply(address, busy ? STATUS_JOB_RUNNING | STATUS_MOVING : 0, this.magic);
    }
    if (address === RUIDA_MEM_CURRENT_X) return encodeRuidaReply(address, 12_500, this.magic);
    if (address === RUIDA_MEM_CURRENT_Y) return encodeRuidaReply(address, -2_000, this.magic);
    return encodeRuidaReply(address, 0, this.magic);
  }

  private byte(value: number): Uint8Array {
    return Uint8Array.of(swizzleByte(value, this.magic));
  }
}

function checksumMatches(datagram: Uint8Array): boolean {
  let sum = 0;
  for (const byte of datagram.slice(2)) sum = (sum + byte) & 0xffff;
  return datagram[0] === ((sum >> 8) & 0xff) && datagram[1] === (sum & 0xff);
}

export type SimulatedRuidaNetwork = RuidaNetworkAdapter & {
  /** Closes the open link from the "network" side, as a failed socket would. */
  readonly dropLink: (reason?: string) => void;
  readonly hosts: string[];
};

/** A RuidaNetworkAdapter whose link is the simulator. Replies arrive on
 *  microtasks (or after replyDelayMs); the deadline runs on timers, so fake
 *  timers drive timeouts. */
export function simulatedRuidaNetwork(
  sim: RuidaUdpSimulator,
  options: { readonly openError?: string; readonly replyDelayMs?: number } = {},
): SimulatedRuidaNetwork {
  let current: SimulatedLink | null = null;
  const hosts: string[] = [];
  return {
    hosts,
    open: (host) => {
      hosts.push(host);
      if (options.openError !== undefined) return Promise.reject(new Error(options.openError));
      current = new SimulatedLink(sim, options.replyDelayMs);
      return Promise.resolve(current);
    },
    deadline: (ms, expire) => {
      const timer = setTimeout(expire, ms);
      return () => clearTimeout(timer);
    },
    dropLink: (reason) => current?.fail(reason),
  };
}

class SimulatedLink implements RuidaDatagramLink {
  private readonly datagrams = new Set<(datagram: Uint8Array) => void>();
  private readonly closes = new Set<(reason?: string) => void>();
  closed = false;
  constructor(
    private readonly sim: RuidaUdpSimulator,
    private readonly replyDelayMs?: number,
  ) {}
  send(datagram: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error('closed'));
    const replies = this.sim.receive(datagram);
    for (const reply of replies) {
      const deliver = (): void => {
        if (this.closed) return;
        for (const handler of this.datagrams) handler(reply);
      };
      if (this.replyDelayMs === undefined) queueMicrotask(deliver);
      else setTimeout(deliver, this.replyDelayMs);
    }
    return Promise.resolve();
  }
  onDatagram(handler: (datagram: Uint8Array) => void): () => void {
    this.datagrams.add(handler);
    return () => this.datagrams.delete(handler);
  }
  onClose(handler: (reason?: string) => void): () => void {
    this.closes.add(handler);
    return () => this.closes.delete(handler);
  }
  close(): Promise<void> {
    this.fail();
    return Promise.resolve();
  }
  fail(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const handler of this.closes) handler(reason);
  }
}
