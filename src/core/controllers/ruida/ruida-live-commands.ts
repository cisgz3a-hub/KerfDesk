// Ruida live-control commands and reply decoding for the network link
// (ADR-697). Every byte meaning here follows public reverse-engineering in
// meerk40t at d511944e (meerk40t/ruida/): rdjob.py L131-134 names D8 00..03
// Start/Stop/Pause/Restore Process, L169 GET_SETTING DA 00 <memory(2)>, L230-242
// the machine-status and current-position memory addresses and status bits,
// and L1332-1361 decode_reply, which reads a reply as DA 01 <memory(2)>
// <value(5)>. controller.py L412-422 sends Stop, Pause and Restore Process as
// standalone writes, each its own datagram; ruidasession.py L286-411 sends one
// datagram at a time, waits for its ACK, and for a DA 00 read waits for one
// further datagram carrying the reply. Clean-room reimplementation; NOT
// verified on a real controller in this repo.

import { decodeCoord35, encodeCoord35 } from './rd-numbers';
import { frameDatagram } from './ruida-udp-session';
import { RUIDA_SWIZZLE_MAGIC, swizzleBytes, unswizzleBytes } from './swizzle';

type Bytes = ReadonlyArray<number>;

/** D8 01 Stop Process: ends the running job (meerk40t controller.abort). */
export const RUIDA_STOP_PROCESS: Bytes = [0xd8, 0x01];
/** D8 02 Pause Process (meerk40t controller.pause). */
export const RUIDA_PAUSE_PROCESS: Bytes = [0xd8, 0x02];
/** D8 03 Restore Process: resumes a paused job (meerk40t controller.resume). */
export const RUIDA_RESTORE_PROCESS: Bytes = [0xd8, 0x03];

/** Memory addresses meerk40t reads with DA 00 (rdjob.py L225-242). */
export const RUIDA_MEM_MACHINE_STATUS = 0x0400;
export const RUIDA_MEM_CURRENT_X = 0x0421;
export const RUIDA_MEM_CURRENT_Y = 0x0431;

// The status bits meerk40t has identified (rdjob.py L232-234: "Status bits
// identified so far"). No bit is known for "paused", so pause is recorded by
// the host, never read back.
const STATUS_MOVING = 0x01000000;
const STATUS_PART_END = 0x00000002;
const STATUS_JOB_RUNNING = 0x00000001;

export type RuidaMachineStatus = {
  readonly raw: number;
  readonly moving: boolean;
  readonly partEnd: boolean;
  readonly jobRunning: boolean;
};

/** Busy when any identified bit is set, as meerk40t's update_machine_status
 *  treats it (controller.py: Moving, Part end and Job running all clear _idle). */
export function ruidaStatusBusy(status: RuidaMachineStatus): boolean {
  return status.moving || status.partEnd || status.jobRunning;
}

export function decodeRuidaMachineStatus(raw: number): RuidaMachineStatus {
  // The identified bits all sit in the low 32 of the 35-bit field.
  const low = raw % 2 ** 32;
  return {
    raw,
    moving: (low & STATUS_MOVING) !== 0,
    partEnd: (low & STATUS_PART_END) !== 0,
    jobRunning: (low & STATUS_JOB_RUNNING) !== 0,
  };
}

/** DA 00 <memory hi> <memory lo>: read one controller memory value. Address
 *  bytes are 7-bit like every Ruida data byte. */
export function ruidaGetSetting(address: number): Bytes {
  return [0xda, 0x00, (address >> 8) & 0x7f, address & 0x7f];
}

/** `value` is the unsigned 35-bit field (meerk40t decodeu35); `signed` reads
 *  it as two's complement, as meerk40t's decode35 does for coordinates. */
export type RuidaMemoryReply = {
  readonly address: number;
  readonly value: number;
  readonly signed: number;
};

/** Decode a reply datagram (swizzled, no checksum: meerk40t unswizzles the
 *  received bytes whole). Null for anything but DA 01 with a full value. */
export function decodeRuidaReply(
  wire: Uint8Array,
  magic: number = RUIDA_SWIZZLE_MAGIC,
): RuidaMemoryReply | null {
  const reply = unswizzleBytes(wire, magic);
  if (reply.length < 9 || reply[0] !== 0xda || reply[1] !== 0x01) return null;
  const address = ((reply[2] ?? 0) << 8) | (reply[3] ?? 0);
  const field = Array.from(reply.slice(4, 9));
  let value = 0;
  for (const byte of field) value = value * 128 + (byte & 0x7f);
  return { address, value, signed: decodeCoord35(field) };
}

/** The reply a controller sends to a DA 00 read, swizzled: for simulators. */
export function encodeRuidaReply(
  address: number,
  value: number,
  magic: number = RUIDA_SWIZZLE_MAGIC,
): Uint8Array {
  const head = [0xda, 0x01, (address >> 8) & 0x7f, address & 0x7f];
  return swizzleBytes([...head, ...encodeCoord35(value)], magic);
}

/** One standalone command as the datagram that carries it: swizzled, then
 *  framed with its checksum. */
export function ruidaCommandDatagram(
  command: Bytes,
  magic: number = RUIDA_SWIZZLE_MAGIC,
): Uint8Array {
  return frameDatagram(swizzleBytes(command, magic));
}
