// A simulated Lihuiyu M2 Nano behind its CH341 bridge (ADR-703), for tests.
// It is a USB session (the ADR-702 contract): vendor control transfers for
// EPP init and the chip version, bulk OUT on endpoint 2 carrying 0xA6 data
// (31 bytes at most per 0xA6) and 0xA0 status requests, bulk IN on endpoint 2
// answering six status bytes [255, code, 0, 0, 0, 1] (MeerK40t's MIT
// ch341/libusb.py CH341GetStatusBulk and ch341/mock.py, at d511944e).
//
// The board model: each 32-byte packet is checked (leading 0x00, CRC-8); a bad
// one answers ERROR once. A good one joins a small FIFO, answering BUSY while
// it is full. Every status read runs one queued packet through the decoder,
// unless the board is paused, so time moves only as the host polls. When the
// board enters its finished state ("FNSE" ends program mode; Home too) with
// the FIFO empty, the next read answers FINISH once. Realtime packets act at once: "PN" toggles
// pause (driver.py pause/resume) and a lone "I" resets — the FIFO is dropped.

import { lhyCrc, LHY_STATUS } from '../../core/controllers/lihuiyu/lhy-packet';
import { LhyDecoder } from './lihuiyu-decoder';

export type SimUsbSetup = {
  readonly requestType: 'vendor' | 'standard' | 'class';
  readonly recipient: 'device' | 'interface' | 'endpoint' | 'other';
  readonly request: number;
  readonly value: number;
  readonly index: number;
};

/** The USB session shape of ADR-702's UsbLinkSession. */
export type SimUsbSession = {
  readonly info: {
    readonly vendorId: number;
    readonly productId: number;
    readonly productName?: string;
  };
  readonly controlTransferOut: (setup: SimUsbSetup, data?: Uint8Array) => Promise<void>;
  readonly controlTransferIn: (setup: SimUsbSetup, length: number) => Promise<Uint8Array>;
  readonly transferOut: (endpointNumber: number, bytes: Uint8Array) => Promise<void>;
  readonly transferIn: (endpointNumber: number, length: number) => Promise<Uint8Array>;
  readonly onDisconnect: (handler: () => void) => () => void;
  readonly close: () => Promise<void>;
  readonly forget: () => Promise<void>;
};

const EPP_DATA = 0xa6;
const EPP_ADDRESS = 0xa7;
const EPP_STATUS = 0xa0;
const PACKET = 32;

export type LihuiyuSimulatorOptions = {
  /** Packets the board holds before it answers BUSY. */
  readonly fifoCapacity?: number;
};

export class LihuiyuSimulator {
  readonly decoder = new LhyDecoder();
  /** Every good payload in arrival order, realtime ones included. */
  readonly received: Uint8Array[] = [];
  readonly controlRequests: number[] = [];
  paused = false;
  resets = 0;
  rejected = 0;
  connected = true;
  private rx: number[] = [];
  private readonly fifo: Uint8Array[] = [];
  private oneShot: number | null = null;
  private statusRequests = 0;
  private corruptNext = 0;
  private readonly capacity: number;
  private readonly disconnectHandlers = new Set<() => void>();

  constructor(options: LihuiyuSimulatorOptions = {}) {
    this.capacity = options.fifoCapacity ?? 4;
  }

  readonly session: SimUsbSession = {
    info: { vendorId: 0x1a86, productId: 0x5512, productName: 'USB2.0-Print (simulated)' },
    controlTransferOut: async (setup) => {
      this.live();
      this.controlRequests.push(setup.request);
    },
    controlTransferIn: async (setup, length) => {
      this.live();
      this.controlRequests.push(setup.request);
      // 0x5F GET_VER: chip version 0x30 (MeerK40t reads 48).
      return new Uint8Array(length).fill(0).map((_, i) => (i === 0 ? 0x30 : 0));
    },
    transferOut: async (endpoint, bytes) => {
      this.live();
      if (endpoint !== 2) throw new Error(`Simulated CH341 has no OUT endpoint ${endpoint}.`);
      this.bulkOut(bytes);
    },
    transferIn: async (endpoint, length) => {
      this.live();
      if (endpoint !== 2) throw new Error(`Simulated CH341 has no IN endpoint ${endpoint}.`);
      if (this.statusRequests === 0) throw new Error('Bulk IN without a 0xA0 status request.');
      this.statusRequests -= 1;
      return Uint8Array.of(255, this.readStatusCode(), 0, 0, 0, 1).subarray(0, length);
    },
    onDisconnect: (handler) => {
      this.disconnectHandlers.add(handler);
      return () => this.disconnectHandlers.delete(handler);
    },
    close: async () => {
      this.connected = false;
    },
    forget: async () => {
      this.connected = false;
    },
  };

  /** The next `count` packets arrive with a bad CRC (as line noise would). */
  corruptNextPackets(count: number): void {
    this.corruptNext = count;
  }

  /** The cable is pulled: every later transfer fails. */
  unplug(): void {
    this.connected = false;
    for (const handler of this.disconnectHandlers) handler();
  }

  /** Runs every queued packet (the board catching up), unless paused. */
  drain(): void {
    while (!this.paused && this.fifo.length > 0) this.runOne();
  }

  get queued(): number {
    return this.fifo.length;
  }

  private live(): void {
    if (!this.connected) throw new Error('The simulated K40 is disconnected.');
  }

  private bulkOut(bytes: Uint8Array): void {
    let at = 0;
    while (at < bytes.length) {
      const command = bytes[at];
      if (command === EPP_STATUS) {
        this.statusRequests += 1;
        at += 1;
      } else if (command === EPP_DATA || command === EPP_ADDRESS) {
        const data = bytes.subarray(at + 1, at + 32);
        if (command === EPP_DATA) this.receive(data);
        at += 1 + data.length;
      } else {
        throw new Error(`Unknown CH341 EPP command 0x${(command ?? 0).toString(16)}.`);
      }
    }
  }

  private receive(data: Uint8Array): void {
    this.rx.push(...data);
    while (this.rx.length >= PACKET) {
      const packet = Uint8Array.from(this.rx.slice(0, PACKET));
      this.rx = this.rx.slice(PACKET);
      this.accept(packet);
    }
  }

  private accept(packet: Uint8Array): void {
    const payload = packet.subarray(1, 31);
    const corrupt = this.corruptNext > 0;
    if (corrupt) this.corruptNext -= 1;
    if (corrupt || packet[0] !== 0 || lhyCrc(payload) !== packet[31]) {
      this.rejected += 1;
      this.oneShot = LHY_STATUS.error;
      return;
    }
    const copy = Uint8Array.from(payload);
    this.received.push(copy);
    const command = commandText(copy);
    if (command === 'PN') this.paused = !this.paused;
    else if (command === 'I') this.reset(copy);
    else this.fifo.push(copy);
  }

  private reset(payload: Uint8Array): void {
    this.fifo.length = 0;
    this.paused = false;
    this.oneShot = null;
    this.resets += 1;
    this.decoder.writePayload(payload);
  }

  private readStatusCode(): number {
    const code = this.statusCode();
    if (!this.paused && this.fifo.length > 0) this.runOne();
    return code;
  }

  private statusCode(): number {
    if (this.oneShot !== null) {
      const code = this.oneShot;
      this.oneShot = null;
      return code;
    }
    return this.fifo.length >= this.capacity ? LHY_STATUS.busy : LHY_STATUS.ok;
  }

  private runOne(): void {
    const payload = this.fifo.shift();
    if (payload === undefined) return;
    const wasFinished = this.decoder.isFinished;
    this.decoder.writePayload(payload);
    // The program ended ("FNSE") or the head homed and nothing is queued.
    if (!wasFinished && this.decoder.isFinished && this.fifo.length === 0) {
      this.oneShot = LHY_STATUS.finish;
    }
  }
}

/** The command a payload carries when the rest is only 'F' padding. */
function commandText(payload: Uint8Array): string | null {
  const text = new TextDecoder().decode(payload).replace(/F+$/, '');
  return text === 'PN' || text === 'I' ? text : null;
}
