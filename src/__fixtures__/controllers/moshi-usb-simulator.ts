// The scripted Moshiboard (moshi-simulator.ts) behind the shared fake USB
// device (ADR-702, ADR-705): it answers the CH341's vendor reads (0x5F chip
// version, 0x52 status, as ch341/libusb.py L317-386 reads them) and unframes
// each bulk OUT transfer — a command byte (A6 data, A7 address) before every
// 31 bytes — into the board's data and address writes. The real CH341 EPP
// driver and the real Moshi link then run against it end to end.

import { createFakeUsbDevice, type FakeUsbDevice } from '../usb/fake-usb-device';
import type { MoshiSimulator } from './moshi-simulator';

const BULK_ENDPOINT = 2;
const EPP_DATA = 0xa6;
const EPP_ADDRESS = 0xa7;
const GET_VERSION = 0x5f;
const GET_STATUS = 0x52;
const PACKET = 32;

export type MoshiUsbSimulator = FakeUsbDevice & {
  /** Bulk OUT bytes no EPP command byte claimed (should stay empty). */
  readonly unframed: number[];
};

export function createMoshiUsbSimulator(
  board: MoshiSimulator,
  chipVersion = 48,
): MoshiUsbSimulator {
  const unframed: number[] = [];
  const device = createFakeUsbDevice({
    controlIn: async (setup, length) => {
      if (setup.request === GET_VERSION) return Uint8Array.of(chipVersion & 0xff, chipVersion >> 8);
      if (setup.request === GET_STATUS) return (await board.readStatus()).subarray(0, length);
      return new Uint8Array(length);
    },
    transferOut: async (endpoint, data) => {
      if (endpoint !== BULK_ENDPOINT) return;
      for (let at = 0; at < data.length; at += PACKET) {
        const packet = data.subarray(at, at + PACKET);
        const payload = packet.subarray(1);
        if (packet[0] === EPP_DATA) await board.writeData(payload);
        else if (packet[0] === EPP_ADDRESS) await board.writeAddress(payload);
        else unframed.push(...packet);
      }
    },
  });
  return { ...device, unframed };
}
