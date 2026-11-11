// A Lihuiyu USB connection over the simulator's USB session (ADR-703 tests):
// CH341 EPP data writes (0xA6 before every 31 bytes, bulk OUT endpoint 2) and
// status reads (0xA0 out, six bytes in on endpoint 2), the framing MeerK40t's
// MIT ch341/libusb.py uses (CH341EppWriteData, CH341GetStatusBulk at d511944e).

import type { LihuiyuUsbConnection } from '../../ui/state/lihuiyu-usb/lihuiyu-usb-types';
import type { LihuiyuSimulator } from './lihuiyu-simulator';

const EPP_DATA = 0xa6;
const EPP_STATUS = 0xa0;

export function lihuiyuSimulatorConnection(simulator: LihuiyuSimulator): LihuiyuUsbConnection {
  const { session } = simulator;
  return {
    label: 'Simulated K40 (M2 Nano)',
    channel: {
      writeData: async (bytes) => {
        const framed: number[] = [];
        for (let at = 0; at < bytes.length; at += 31) {
          framed.push(EPP_DATA, ...bytes.subarray(at, at + 31));
        }
        await session.transferOut(2, Uint8Array.from(framed));
      },
      readStatus: async () => {
        await session.transferOut(2, Uint8Array.of(EPP_STATUS));
        return session.transferIn(2, 6);
      },
    },
    onDisconnect: session.onDisconnect,
    close: session.close,
  };
}
