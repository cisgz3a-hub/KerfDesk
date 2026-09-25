// Pure Ruida UDP session state machine (ADR-097 groundwork). Ruida network
// transport per public research: datagrams to the controller's port 50200,
// replies to the host's port 40200 (meerk40t udp_transport.py L16-18), each
// datagram carrying a 2-byte checksum (16-bit sum of the swizzled payload)
// followed by at most 1470 payload bytes. The controller answers each datagram
// with one byte, swizzled with the same magic as the payload: 0xCC (ACK)
// accepts it and 0xCF (NAK) asks for it again (meerk40t rdjob.py); 0xCE (ENQ)
// is a keepalive, not a verdict on the datagram. Comparing the raw wire byte
// with 0xCC would read every real ACK (0xC6 with magic 0x88) as a failure
// (controller audit drivers-6). This module only slices/frames/acks — no
// sockets, no clock — so it is fully testable; the Electron UDP socket + IPC
// bridge that would feed it is NOT built yet, which is why Ruida profiles stay
// transport:'file-only'.
//
// Audit RU-8, before any socket is wired: the payload is split only between
// commands (meerk40t controller.py L83-94 queues whole commands), and a reply
// that never arrives ends the session in an explicit failure instead of
// waiting in 'awaiting-ack' forever (meerk40t ruidasession.py L352-369 gives up
// after its receive tries and marks the comms failed). A timeout never resends:
// UDP has no sequence numbers, so if only the ACK was lost a resend would run
// the same commands twice.

import { RUIDA_SWIZZLE_MAGIC, unswizzleByte } from './swizzle';

/** The controller's command port. */
export const RUIDA_UDP_PORT = 50200;
/** The port the host binds to receive the controller's replies. */
export const RUIDA_UDP_HOST_LISTEN_PORT = 40200;
/** How long the host waits for a datagram's verdict: meerk40t's normal comms
 *  timeout (1 s, four 0.25 s socket reads). */
export const RUIDA_ACK_TIMEOUT_MS = 1000;
export const RUIDA_ACK = 0xcc;
export const RUIDA_NAK = 0xcf;
export const RUIDA_ENQ = 0xce;
export const RUIDA_MAX_PAYLOAD_BYTES = 1470;

export type RuidaSessionStatus = 'idle' | 'sending' | 'awaiting-ack' | 'done' | 'failed';

export type RuidaSessionFailure =
  // The controller NAKed one datagram more often than the retry budget.
  | 'nak-retries-exhausted'
  // No ACK or NAK arrived within RUIDA_ACK_TIMEOUT_MS.
  | 'ack-timeout'
  // One command is longer than a datagram's payload, so it cannot be sent
  // without splitting it. No encoder output does this.
  | 'command-exceeds-datagram';

export type RuidaSessionState = {
  readonly status: RuidaSessionStatus;
  /** Why the session failed; present only when status is 'failed'. */
  readonly failure?: RuidaSessionFailure;
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

/** Split a swizzled job into datagram payloads of at most `maxBytes`, cutting
 *  only where a command starts (an unswizzled byte >= 0x80). Null when a single
 *  command is longer than `maxBytes`. */
export function splitAtCommandBoundaries(
  swizzledJob: Uint8Array,
  magic: number = RUIDA_SWIZZLE_MAGIC,
  maxBytes: number = RUIDA_MAX_PAYLOAD_BYTES,
): Uint8Array[] | null {
  const chunks: Uint8Array[] = [];
  let chunkStart = 0;
  let commandStart = 0;
  for (let end = 1; end <= swizzledJob.length; end += 1) {
    const commandEnds =
      end === swizzledJob.length || unswizzleByte(swizzledJob[end] ?? 0, magic) >= 0x80;
    if (!commandEnds) continue;
    if (end - commandStart > maxBytes) return null;
    if (end - chunkStart > maxBytes) {
      chunks.push(swizzledJob.slice(chunkStart, commandStart));
      chunkStart = commandStart;
    }
    commandStart = end;
  }
  if (chunkStart < swizzledJob.length) chunks.push(swizzledJob.slice(chunkStart));
  return chunks;
}

export function createRuidaSession(
  swizzledJob: Uint8Array,
  magic: number = RUIDA_SWIZZLE_MAGIC,
): RuidaSessionState {
  const chunks = splitAtCommandBoundaries(swizzledJob, magic);
  const base = { nextPacket: 0, retriesLeft: DEFAULT_RETRIES, magic };
  if (chunks === null) {
    return { ...base, status: 'failed', failure: 'command-exceeds-datagram', packets: [] };
  }
  const packets = chunks.map(frameDatagram);
  return { ...base, status: packets.length === 0 ? 'done' : 'idle', packets };
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
 *  session fails; ENQ and unknown bytes are no verdict and change nothing. */
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
    return {
      state: { ...state, status: 'failed', failure: 'nak-retries-exhausted' },
      toSend: null,
    };
  }
  const retry = state.packets[state.nextPacket];
  return {
    state: { ...state, retriesLeft: state.retriesLeft - 1 },
    toSend: retry ?? null,
  };
}

/** The verdict deadline (RUIDA_ACK_TIMEOUT_MS) passed with no ACK or NAK. The
 *  session fails and nothing is resent; any other state is unchanged. */
export function onRuidaAckTimeout(state: RuidaSessionState): RuidaSessionStep {
  if (state.status !== 'awaiting-ack') return { state, toSend: null };
  return { state: { ...state, status: 'failed', failure: 'ack-timeout' }, toSend: null };
}
