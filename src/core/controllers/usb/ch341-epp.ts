// The CH341 USB bridge in EPP 1.9 parallel mode (ADR-702), the chip on the
// Lihuiyu M2/M3 Nano (stock K40) and Moshiboard controllers. This is the part
// of the chip those boards use, not a full CH341 driver. Simulator-tested only;
// not qualified on hardware.
//
// Source: meerk40t d511944e08788e88077727f682957759884ff5ca (MIT),
// meerk40t/ch341/libusb.py — the VID/PID and endpoints (L6-9), the parallel
// command bytes (L12-16, L20-27), CH341InitParallel's 0x40/0xB1 with
// value mode<<8|2 (L264-288), CH341GetVerIC's 0xC0/0x5F two-byte read
// (L367-386), CH341GetStatusBulk's A0 write and six-byte read (L338-365),
// CH341GetStatusControlTransfer's 0xC0/0x52 eight-byte read (L317-336) and
// CH341EppWrite's A6/A7 prefix before every 31 data bytes (L425-446). That
// loop inserts floor(n/32)+1 prefixes; ch341EppFrame prefixes every 31-byte
// packet: the same bytes for every write up to 62 bytes (a Lihuiyu packet is
// 34), and past that it never leaves a 32-byte packet without its prefix.

import type { UsbControlSetup, UsbDeviceFilter, UsbLinkSession } from './usb-link-session';

export const CH341_USB_FILTER: UsbDeviceFilter = { vendorId: 0x1a86, productId: 0x5512 };

/** Bulk OUT 0x02 and bulk IN 0x82 are both endpoint number 2. */
const BULK_ENDPOINT = 2;
const PARA_CMD_STS = 0xa0;
const PARA_CMD_W0 = 0xa6; // data write: WR=0, DS=0, AS=1
const PARA_CMD_W1 = 0xa7; // address write: WR=0, DS=1, AS=0
const PARA_INIT = 0xb1;
const GET_VERSION = 0x5f;
const GET_STATUS = 0x52;
const EPP_19 = 0x01;
/** A 32-byte USB packet holds the command byte and 31 data bytes. */
const DATA_PER_PACKET = 31;
const BULK_STATUS_LENGTH = 6;
const CONTROL_STATUS_LENGTH = 8;

/**
 * How the board's status is read. MeerK40t reads a Lihuiyu board by bulk
 * (lihuiyu/controller.py `bulk=True`: write A0, read six bytes) and a
 * Moshiboard by control transfer (moshi/controller.py `bulk=False`: vendor
 * request 0x52, eight bytes). Either way the board's status code is byte 1.
 */
export type Ch341StatusRead = 'bulk' | 'control';

export type Ch341Epp = {
  readonly chipVersion: number;
  /** EPP data write (A6 framing). */
  readonly writeData: (bytes: Uint8Array) => Promise<void>;
  /** EPP address write (A7 framing). */
  readonly writeAddress: (bytes: Uint8Array) => Promise<void>;
  /** The raw status bytes; the board's status code is byte 1. */
  readonly readStatus: () => Promise<Uint8Array>;
  readonly close: () => Promise<void>;
};

export type Ch341EppOptions = {
  readonly status: Ch341StatusRead;
};

function vendorRequest(request: number, value: number): UsbControlSetup {
  return { requestType: 'vendor', recipient: 'device', request, value, index: 0 };
}

/** The bytes for one EPP write: the command byte before every 31 data bytes. */
export function ch341EppFrame(command: number, bytes: Uint8Array): Uint8Array {
  const packets = Math.ceil(bytes.length / DATA_PER_PACKET);
  const framed = new Uint8Array(bytes.length + packets);
  for (let p = 0; p < packets; p += 1) {
    const start = p * DATA_PER_PACKET;
    const chunk = bytes.subarray(start, start + DATA_PER_PACKET);
    framed[start + p] = command;
    framed.set(chunk, start + p + 1);
  }
  return framed;
}

async function readChipVersion(session: UsbLinkSession): Promise<number> {
  const bytes = await session.controlTransferIn(vendorRequest(GET_VERSION, 0), 2);
  return ((bytes[1] ?? 0) << 8) | (bytes[0] ?? 0);
}

/** Puts the chip in EPP 1.9 mode and returns the operations the boards use. */
export async function openCh341Epp(
  session: UsbLinkSession,
  options: Ch341EppOptions,
): Promise<Ch341Epp> {
  await session.controlTransferOut(vendorRequest(PARA_INIT, (EPP_19 << 8) | 2));
  const chipVersion = await readChipVersion(session);
  const write = async (command: number, bytes: Uint8Array): Promise<void> => {
    if (bytes.length === 0) return;
    await session.transferOut(BULK_ENDPOINT, ch341EppFrame(command, bytes));
  };
  const readStatus =
    options.status === 'bulk'
      ? async (): Promise<Uint8Array> => {
          await session.transferOut(BULK_ENDPOINT, Uint8Array.of(PARA_CMD_STS));
          return session.transferIn(BULK_ENDPOINT, BULK_STATUS_LENGTH);
        }
      : (): Promise<Uint8Array> =>
          session.controlTransferIn(vendorRequest(GET_STATUS, 0), CONTROL_STATUS_LENGTH);
  return {
    chipVersion,
    writeData: (bytes) => write(PARA_CMD_W0, bytes),
    writeAddress: (bytes) => write(PARA_CMD_W1, bytes),
    readStatus,
    close: () => session.close(),
  };
}
