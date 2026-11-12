// The few Ruida wire facts the main process needs on its own (ADR-697): the
// UDP ports and the Stop Process datagram it sends on a session the window can
// no longer reach. The main process cannot import src/ (its own rootDir), so
// these mirror src/core/controllers/ruida (swizzle.ts, ruida-udp-session.ts,
// ruida-live-commands.ts); ruida-network-wire.test.ts holds them equal.
//
// Sources: meerk40t at d511944e — udp_transport.py L17-18 (send to 50200,
// listen on 40200), rdjob.py L132 (STOP_PROCESS = D8 01), controller.py
// L412-414 (abort sends Stop Process), swizzle_byte in rdjob.py (MIT; see
// docs/licensing/meerk40t-ruida.txt).

/** The controller's command port. */
export const RUIDA_CONTROLLER_PORT = 50200;
/** The port the host binds so the controller's replies reach it. */
export const RUIDA_HOST_LISTEN_PORT = 40200;
/** A framed datagram: 2 checksum bytes and at most 1470 payload bytes. */
export const RUIDA_MAX_DATAGRAM_BYTES = 1472;

function swizzle(value: number, magic: number): number {
  let b = value & 0xff;
  b ^= (b >> 7) & 0xff;
  b ^= (b << 7) & 0xff;
  b ^= (b >> 7) & 0xff;
  b ^= magic;
  return (b + 1) & 0xff;
}

/** D8 01 Stop Process, swizzled with `magic` and framed with its checksum. */
export function ruidaStopDatagram(magic: number): Buffer {
  const payload = [0xd8, 0x01].map((byte) => swizzle(byte, magic));
  let sum = 0;
  for (const byte of payload) sum = (sum + byte) & 0xffff;
  return Buffer.from([(sum >> 8) & 0xff, sum & 0xff, ...payload]);
}

export function validRuidaMagic(magic: unknown): magic is number {
  return typeof magic === 'number' && Number.isInteger(magic) && magic >= 0 && magic <= 0xff;
}
