// Pure Ruida UDP session state machine (ADR-097 groundwork). Ruida network
// transport per public research: datagrams to port 50200, each carrying a
// 2-byte checksum (16-bit sum of the swizzled payload) followed by at most
// ~1470 payload bytes. The controller answers each datagram with one byte,
// swizzled with the same magic as the payload: 0xCC (ACK) accepts it and 0xCF
// (NAK) asks for it again (MeerK40t rdjob.py); 0xCE (ENQ) is a keepalive, not a
// verdict on the datagram. Comparing the raw wire byte with 0xCC would read
// every real ACK (0xC6 with magic 0x88) as a failure (controller audit
// drivers-6). This module only slices/frames/acks — no sockets — so it is
// fully testable; the Electron UDP socket + IPC bridge that would feed it is
// NOT built yet, which is why Ruida profiles stay transport:'file-only'.

import { RUIDA_SWIZZLE_MAGIC, unswizzleByte } from './swizzle';

export const RUIDA_UDP_PORT = 50200;
export const RUIDA_ACK = 0xcc;
export const RUIDA_NAK = 0xcf;
export const RUIDA_ENQ = 0xce;
const MAX_PAYLOAD_BYTES = 1470;

export type RuidaSessionStatus = 'idle' | 'sending' | 'awaiting-ack' | 'done' | 'errored';

export type RuidaSessionState = {
  readonly status: RuidaSessionStatus;
  readonly packets: ReadonlyArray<Uint8Array>;
  readonly nextPacket: number;
  readonly retriesLeft: number;
  /** The swizzle magic of the payload, which the replies share. It varies by
   *  controller (0x88 for RDC644x; EduTech notes 0x11 for the 634XG). */
  readonly magic: number;
};

export type RuidaSessionStep = {
  readonly state: RuidaSessionState;
  /** Datagram to transmit now, or null when waiting/finished. */
  readonly toSend: Uint8Array | null;
};

const DEFAULT_RETRIES = 3;

/** Frame one datagram: 16-bit big-endian checksum over the payload, then the
 *  payload itself. The payload must already be swizzled. */
export function frameDatagram(payload: Uint8Array): Uint8Array {
  let sum = 0;
  for (const byte of payload) sum = (sum + byte) & 0xffff;
  const out = new Uint8Array(payload.length + 2);
  out[0] = (sum >> 8) & 0xff;
  out[1] = sum & 0xff;
  out.set(payload, 2);
  return out;
}

export function createRuidaSession(
  swizzledJob: Uint8Array,
  magic: number = RUIDA_SWIZZLE_MAGIC,
): RuidaSessionState {
  const packets: Uint8Array[] = [];
  for (let offset = 0; offset < swizzledJob.length; offset += MAX_PAYLOAD_BYTES) {
    packets.push(frameDatagram(swizzledJob.slice(offset, offset + MAX_PAYLOAD_BYTES)));
  }
  return {
    status: packets.length === 0 ? 'done' : 'idle',
    packets,
    nextPacket: 0,
    retriesLeft: DEFAULT_RETRIES,
    magic,
  };
}

/** Advance: emit the next datagram when idle/sending. */
export function stepRuidaSession(state: RuidaSessionState): RuidaSessionStep {
  if (state.status !== 'idle' && state.status !== 'sending') return { state, toSend: null };
  const packet = state.packets[state.nextPacket];
  if (packet === undefined) return { state: { ...state, status: 'done' }, toSend: null };
  return { state: { ...state, status: 'awaiting-ack' }, toSend: packet };
}

/** Consume one controller response byte as it arrived on the wire. ACK
 *  advances; NAK retries the same datagram up to the retry budget, then the
 *  session is terminal; ENQ and unknown bytes are no verdict and change nothing. */
export function onRuidaResponse(state: RuidaSessionState, wireByte: number): RuidaSessionStep {
  if (state.status !== 'awaiting-ack') return { state, toSend: null };
  const reply = unswizzleByte(wireByte, state.magic);
  if (reply === RUIDA_ACK) {
    const nextPacket = state.nextPacket + 1;
    const finished = nextPacket >= state.packets.length;
    return {
      state: {
        ...state,
        status: finished ? 'done' : 'sending',
        nextPacket,
        retriesLeft: DEFAULT_RETRIES,
      },
      toSend: null,
    };
  }
  if (reply !== RUIDA_NAK) return { state, toSend: null };
  if (state.retriesLeft <= 0) {
    return { state: { ...state, status: 'errored' }, toSend: null };
  }
  const retry = state.packets[state.nextPacket];
  return {
    state: { ...state, retriesLeft: state.retriesLeft - 1 },
    toSend: retry ?? null,
  };
}
