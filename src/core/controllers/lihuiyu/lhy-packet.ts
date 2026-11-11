// LHYMicro-GL packets (ADR-703), from MeerK40t's MIT controller.py
// (meerk40t/lihuiyu/controller.py at d511944e). The board takes 32-byte
// packets: 0x00, 30 payload bytes and a Dallas/Maxim one-wire CRC-8 of the
// payload (onewire_crc_lookup, L118-142). The host cuts its command stream
// into payloads the way process_queue does (L644-737): at most 30 bytes, or
// up to and including the first '\n'. A newline ends a payload, which is then
// padded with 'F' ('AT' payloads with 0x00); a '-' before the newline asks
// the host to wait until the board reports it has finished (wait_finished).
// The board answers a status read with six bytes; byte 1 is the code below.

export const LHY_PAYLOAD_BYTES = 30;
export const LHY_PACKET_BYTES = 32;

/** controller.py L22-32. */
export const LHY_STATUS = {
  okM3Finish: 204,
  ok: 206,
  error: 207,
  finish: 236,
  busy: 238,
  power: 239,
} as const;

export function lhyStatusName(code: number): string {
  switch (code) {
    case LHY_STATUS.ok:
      return 'OK';
    case LHY_STATUS.busy:
      return 'Busy';
    case LHY_STATUS.error:
      return 'Rejected';
    case LHY_STATUS.finish:
      return 'Finished';
    case LHY_STATUS.power:
      return 'Low power';
    case LHY_STATUS.okM3Finish:
      return 'M3 finished';
    case 0:
      return 'No USB status';
    default:
      return `Unknown (0x${code.toString(16).padStart(2, '0')})`;
  }
}

/** wait_finished's test (L894-896): bit 1 clear means the board has finished. */
export function lhyStatusFinished(code: number): boolean {
  return code !== 0 && (code & 0x02) === 0;
}

/** Dallas/Maxim one-wire CRC-8 (reflected polynomial 0x8C, initial 0), the
 *  CRC MeerK40t computes with Arjen Lentz's 32-entry table; computed bitwise
 *  here (lhy-packet.test.ts checks it against that table's values). */
export function lhyCrc(payload: Uint8Array): number {
  let crc = 0;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0x8c : crc >>> 1;
  }
  return crc;
}

/** The 32 bytes the board takes for one 30-byte payload. */
export function lhyPacket(payload: Uint8Array): Uint8Array {
  if (payload.length !== LHY_PAYLOAD_BYTES) {
    throw new RangeError(`An LHY payload is ${LHY_PAYLOAD_BYTES} bytes, got ${payload.length}.`);
  }
  const packet = new Uint8Array(LHY_PACKET_BYTES);
  packet.set(payload, 1);
  packet[LHY_PACKET_BYTES - 1] = lhyCrc(payload);
  return packet;
}

export type LhyPayload = {
  readonly payload: Uint8Array;
  /** The stream asked to wait for the board's finish after this payload. */
  readonly waitFinish: boolean;
};

const NEWLINE = 0x0a;
const META = new Set([0x2d, 0x2a, 0x26, 0x21, 0x23, 0x25, 0x18]); // - * & ! # % CAN
const F = 0x46;
const P = 0x50;
const HASH = 0x23;
const DASH = 0x2d;

/** Splits an LHY command stream into payloads (process_queue's packet rules
 *  for the characters this app writes: newline, '-' and '#'). */
export function lhyPayloads(stream: Uint8Array): ReadonlyArray<LhyPayload> {
  const payloads: LhyPayload[] = [];
  let at = 0;
  while (at < stream.length) {
    const window = stream.subarray(at, at + LHY_PAYLOAD_BYTES);
    const newline = window.indexOf(NEWLINE);
    let length = newline === -1 ? window.length : newline + 1;
    const last = stream[at + length - 1];
    if (last !== undefined && META.has(last) && at + length < stream.length) length += 1;
    payloads.push(lhyPayloadFrom(stream.subarray(at, at + length)));
    at += length;
  }
  return payloads;
}

function lhyPayloadFrom(raw: Uint8Array): LhyPayload {
  const isAt = raw[0] === 0x41 && raw[1] === 0x54; // "AT"
  let bytes = Array.from(raw);
  let waitFinish = false;
  if (bytes[bytes.length - 1] === NEWLINE) {
    bytes = bytes.slice(0, -1);
    if (!isAt) {
      if (bytes.length === 0) bytes.push(F);
      if (bytes[bytes.length - 1] === P) bytes.push(F);
      else if (bytes[bytes.length - 1] === DASH) {
        bytes = bytes.slice(0, -1);
        waitFinish = true;
      }
    }
  }
  let padder = isAt ? 0 : F;
  if (!isAt && bytes[bytes.length - 1] === HASH) {
    bytes = bytes.slice(0, -1);
    padder = bytes[bytes.length - 1] ?? F;
  }
  const payload = new Uint8Array(LHY_PAYLOAD_BYTES).fill(padder);
  payload.set(bytes.slice(0, LHY_PAYLOAD_BYTES));
  return { payload, waitFinish };
}

/** A command-only payload: `text` padded with 'F' ("PN" pause, "I" reset). */
export function lhyCommandPayload(text: string): Uint8Array {
  return lhyPayloads(new TextEncoder().encode(`${text}\n`))[0]?.payload ?? new Uint8Array(0);
}
