// Pure Ruida UDP session state machine (ADR-097 groundwork). Ruida network
// transport per public research: datagrams to port 50200, each carrying a
// 2-byte checksum (16-bit sum of the swizzled payload) followed by at most
// ~1470 payload bytes; the controller answers 0xCC (ACK) or 0xCE (error) per
// datagram. This module only slices/frames/acks — no sockets — so it is
// fully testable; the Electron UDP socket + IPC bridge that would feed it is
// NOT built yet, which is why Ruida profiles stay transport:'file-only'.

export const RUIDA_UDP_PORT = 50200;
export const RUIDA_ACK = 0xcc;
export const RUIDA_ERR = 0xce;
const MAX_PAYLOAD_BYTES = 1470;

export type RuidaSessionStatus = 'idle' | 'sending' | 'awaiting-ack' | 'done' | 'errored';

export type RuidaSessionState = {
  readonly status: RuidaSessionStatus;
  readonly packets: ReadonlyArray<Uint8Array>;
  readonly nextPacket: number;
  readonly retriesLeft: number;
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

export function createRuidaSession(swizzledJob: Uint8Array): RuidaSessionState {
  const packets: Uint8Array[] = [];
  for (let offset = 0; offset < swizzledJob.length; offset += MAX_PAYLOAD_BYTES) {
    packets.push(frameDatagram(swizzledJob.slice(offset, offset + MAX_PAYLOAD_BYTES)));
  }
  return {
    status: packets.length === 0 ? 'done' : 'idle',
    packets,
    nextPacket: 0,
    retriesLeft: DEFAULT_RETRIES,
  };
}

/** Advance: emit the next datagram when idle/sending. */
export function stepRuidaSession(state: RuidaSessionState): RuidaSessionStep {
  if (state.status !== 'idle' && state.status !== 'sending') return { state, toSend: null };
  const packet = state.packets[state.nextPacket];
  if (packet === undefined) return { state: { ...state, status: 'done' }, toSend: null };
  return { state: { ...state, status: 'awaiting-ack' }, toSend: packet };
}

/** Consume one controller response byte (ACK/ERR). ERR retries the same
 *  datagram up to the retry budget, then the session is terminal. */
export function onRuidaResponse(state: RuidaSessionState, byte: number): RuidaSessionStep {
  if (state.status !== 'awaiting-ack') return { state, toSend: null };
  if (byte === RUIDA_ACK) {
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
  if (state.retriesLeft <= 0) {
    return { state: { ...state, status: 'errored' }, toSend: null };
  }
  const retry = state.packets[state.nextPacket];
  return {
    state: { ...state, retriesLeft: state.retriesLeft - 1 },
    toSend: retry ?? null,
  };
}
