// Controller audit 2026-09-25 RU-8 (latent: nothing outside tests creates a
// session yet). meerk40t queues whole commands per datagram (controller.py
// L83-94), gives up on a datagram whose ACK never arrives (ruidasession.py
// L352-369) and receives replies on the host's UDP port 40200
// (udp_transport.py L16-18).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../devices';
import type { Job } from '../../job';
import { encodeRdJob } from './rd-encoder';
import {
  createRuidaSession,
  onRuidaAckTimeout,
  onRuidaResponse,
  RUIDA_ACK,
  RUIDA_MAX_PAYLOAD_BYTES,
  RUIDA_UDP_HOST_LISTEN_PORT,
  RUIDA_UDP_PORT,
  splitAtCommandBoundaries,
  stepRuidaSession,
} from './ruida-udp-session';
import { swizzleByte, swizzleBytes, unswizzleByte } from './swizzle';

// Many short cuts: a real .rd stream several datagrams long.
function largeRdJob(): Uint8Array {
  const polyline = Array.from({ length: 400 }, (_, i) => ({ x: i % 2 === 0 ? 0 : 5, y: i }));
  const job: Job = {
    groups: [
      {
        kind: 'cut',
        layerId: 'L1',
        color: '#000000',
        power: 50,
        speed: 1500,
        passes: 1,
        airAssist: false,
        segments: [{ polyline, closed: false }],
      },
    ],
  };
  const encoded = encodeRdJob(job, { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' });
  if (!encoded.ok) throw new Error(encoded.error.kind);
  return encoded.bytes;
}

function isCommandByte(wireByte: number | undefined): boolean {
  return wireByte !== undefined && unswizzleByte(wireByte) >= 0x80;
}

describe('RU-8: Ruida datagrams split between commands', () => {
  it('never splits a command and keeps every payload within 1470 bytes', () => {
    const job = largeRdJob();
    const chunks = splitAtCommandBoundaries(job);
    if (chunks === null) throw new Error('a command exceeded a datagram');
    expect(chunks.length).toBeGreaterThan(1);
    let offset = 0;
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk.length).toBeLessThanOrEqual(RUIDA_MAX_PAYLOAD_BYTES);
      // Each datagram starts a command, and the next byte after it starts one.
      expect(isCommandByte(chunk[0])).toBe(true);
      offset += chunk.length;
      if (offset < job.length) expect(isCommandByte(job[offset])).toBe(true);
    }
    expect(offset).toBe(job.length);
    expect(Buffer.concat(chunks).equals(Buffer.from(job))).toBe(true);
  });

  it('ends a datagram at the last command boundary that fits', () => {
    const job = largeRdJob();
    // The fixed 1470-byte slicing this replaced ended every datagram at 1470,
    // wherever that fell.
    let boundary = RUIDA_MAX_PAYLOAD_BYTES;
    while (!isCommandByte(job[boundary])) boundary -= 1;
    expect(splitAtCommandBoundaries(job)?.[0]?.length).toBe(boundary);
  });

  it('frames one datagram per chunk and sends them in order', () => {
    const job = largeRdJob();
    const chunks = splitAtCommandBoundaries(job) ?? [];
    let state = createRuidaSession(job);
    const sent: Uint8Array[] = [];
    for (;;) {
      const step = stepRuidaSession(state);
      state = step.state;
      if (step.toSend === null) break;
      sent.push(step.toSend);
      state = onRuidaResponse(state, swizzleByte(RUIDA_ACK)).state;
    }
    expect(state.status).toBe('done');
    expect(sent.map((datagram) => datagram.slice(2))).toEqual(chunks);
  });

  it('fails instead of splitting a command longer than a datagram', () => {
    // 0x00 data bytes after one command byte: a single 1471-byte "command".
    const unframeable = swizzleBytes([0xe7, ...Array<number>(RUIDA_MAX_PAYLOAD_BYTES).fill(0)]);
    expect(splitAtCommandBoundaries(unframeable)).toBeNull();
    const state = createRuidaSession(unframeable);
    expect(state).toMatchObject({ status: 'failed', failure: 'command-exceeds-datagram' });
    expect(stepRuidaSession(state).toSend).toBeNull();
  });
});

describe('RU-8: a missing reply ends the session', () => {
  it('fails on an ACK timeout without resending the datagram', () => {
    const awaiting = stepRuidaSession(createRuidaSession(largeRdJob())).state;
    expect(awaiting.status).toBe('awaiting-ack');
    const timedOut = onRuidaAckTimeout(awaiting);
    expect(timedOut.toSend).toBeNull();
    expect(timedOut.state).toMatchObject({ status: 'failed', failure: 'ack-timeout' });
    // Terminal: a late ACK and further steps change nothing.
    expect(onRuidaResponse(timedOut.state, swizzleByte(RUIDA_ACK)).state).toBe(timedOut.state);
    expect(stepRuidaSession(timedOut.state)).toEqual({ state: timedOut.state, toSend: null });
  });

  it('ignores a timeout when no verdict is owed', () => {
    const idle = createRuidaSession(largeRdJob());
    expect(onRuidaAckTimeout(idle)).toEqual({ state: idle, toSend: null });
  });
});

describe('Ruida UDP ports', () => {
  it('sends to the controller on 50200 and listens for replies on 40200', () => {
    expect(RUIDA_UDP_PORT).toBe(50200);
    expect(RUIDA_UDP_HOST_LISTEN_PORT).toBe(40200);
  });
});
