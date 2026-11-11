// The Moshiboard live protocol over a CH341 in EPP mode (ADR-705), from
// MeerK40t (MIT) meerk40t/moshi/controller.py at d511944e:
// - program bytes go out as EPP data writes in 32-byte packets with no status
//   check between packets (`process_buffer` L697-719, `send_packet` L721-734);
// - before a program: wait for status OK, then the prologue as an EPP address
//   write (L642-647, builder.py `prologue` L701-709);
// - after it: read status, then the epilogue address write (L649-656,
//   builder.py `epilogue` L711-722), then poll until the board reports OK
//   again (`wait_finished` L793-838, every 0.5 s while it reports busy);
// - Abort is the estop address write; the host drops every queued program
//   (`realtime` L381-402, builder.py `stop` L734-742).
// The status is byte 1 of a CH341 vendor-read status (MeerK40t opens the
// Moshi CH341 with `bulk=False`, L277-284, so ch341/libusb.py
// `CH341GetStatusControlTransfer` L317-335: request 0x52, 8 bytes).

import { MOSHI_EPILOGUE, MOSHI_ESTOP, MOSHI_PROLOGUE, moshiCommandByte } from './moshi-swizzle';

/** Status byte values (controller.py L35-38). */
export const MOSHI_STATUS_OK = 205;
export const MOSHI_STATUS_PROCESSING = 207;
export const MOSHI_STATUS_ERROR = 237;
export const MOSHI_STATUS_RESET = 239;

/** EPP data packets are this long (controller.py L714). */
export const MOSHI_PACKET_BYTES = 32;
/** `wait_finished` polls a busy board every half second (controller.py L836-837). */
export const MOSHI_BUSY_POLL_MS = 500;
/** `wait_until_accepting_packets` polls every 50 ms (controller.py L787). */
export const MOSHI_READY_POLL_MS = 50;

/** CH341 vendor read of the parallel-port status (ch341/libusb.py L22, L27). */
export const CH341_VENDOR_STATUS_REQUEST = 0x52;
export const CH341_VENDOR_STATUS_LENGTH = 8;

export const MOSHI_PROLOGUE_BYTE = moshiCommandByte(MOSHI_PROLOGUE);
export const MOSHI_EPILOGUE_BYTE = moshiCommandByte(MOSHI_EPILOGUE);
/** Estop. MeerK40t's free-motor command is the same byte (builder.py L311-312). */
export const MOSHI_ESTOP_BYTE = moshiCommandByte(MOSHI_ESTOP);

/** The status code in a status read: byte 1 (controller.py L780, L823). */
export function moshiStatusCode(status: Uint8Array): number | null {
  return status.length > 1 ? (status[1] ?? null) : null;
}

/** controller.py `get_code_string_from_moshicode` L41-70. */
export function moshiStatusText(code: number | null): string {
  switch (code) {
    case null:
      return 'unknown';
    case MOSHI_STATUS_OK:
      return 'OK';
    case MOSHI_STATUS_PROCESSING:
      return 'Processing';
    case MOSHI_STATUS_ERROR:
      return 'Error';
    case MOSHI_STATUS_RESET:
      return 'Resetting';
    case 0:
      return 'USB failed';
    default:
      return `unknown code ${code.toString(16).padStart(2, '0')}`;
  }
}

/** Splits a program into the EPP data packets MeerK40t sends. */
export function moshiPackets(program: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  for (let at = 0; at < program.length; at += MOSHI_PACKET_BYTES) {
    packets.push(program.subarray(at, at + MOSHI_PACKET_BYTES));
  }
  return packets;
}
