import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../devices';
import type { Job } from '../../job';
import { decodeRdStream } from '../../../__fixtures__/controllers/ruida-decoder';
import { ruidaDriver } from './driver';
import { encodeRdJob } from './rd-encoder';
import { decodeCoord35, decodePower14, encodeCoord35, encodePower14 } from './rd-numbers';
import {
  createRuidaSession,
  frameDatagram,
  onRuidaResponse,
  RUIDA_ACK,
  RUIDA_ERR,
  stepRuidaSession,
} from './ruida-udp-session';
import { swizzleByte, unswizzleByte } from './swizzle';

const RUIDA_DEVICE = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' as const };

const JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 50,
      speed: 1500,
      passes: 2,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

describe('ruida swizzle', () => {
  it('round-trips every byte value', () => {
    for (let b = 0; b <= 0xff; b += 1) {
      expect(unswizzleByte(swizzleByte(b))).toBe(b);
    }
  });

  it('is not the identity (bytes really are scrambled)', () => {
    const changed = Array.from({ length: 256 }, (_, b) => swizzleByte(b) !== b).filter(Boolean);
    expect(changed.length).toBeGreaterThan(200);
  });
});

describe('ruida number encodings', () => {
  it('round-trips 35-bit coordinates including negatives', () => {
    for (const value of [0, 1, 12345, 900000, -1, -50000, 2 ** 30]) {
      expect(decodeCoord35([...encodeCoord35(value)])).toBe(value);
    }
  });

  it('keeps all encoded bytes below 0x80', () => {
    for (const byte of [...encodeCoord35(987654), ...encodePower14(73)]) {
      expect(byte).toBeLessThan(0x80);
    }
  });

  it('round-trips power percentages within scale resolution', () => {
    for (const percent of [0, 1, 50, 99.5, 100]) {
      expect(decodePower14([...encodePower14(percent)])).toBeCloseTo(percent, 1);
    }
  });
});

describe('encodeRdJob', () => {
  it('is deterministic (non-negotiable #5)', () => {
    const a = encodeRdJob(JOB, RUIDA_DEVICE);
    const b = encodeRdJob(JOB, RUIDA_DEVICE);
    if (!a.ok || !b.ok) throw new Error('encode failed');
    expect([...a.bytes]).toEqual([...b.bytes]);
  });

  it('round-trips through the decoder: structure, power, speed, geometry', () => {
    const encoded = encodeRdJob(JOB, RUIDA_DEVICE);
    if (!encoded.ok) throw new Error('encode failed');
    const events = decodeRdStream(encoded.bytes);
    expect(events[0]).toEqual({ kind: 'stream-start' });
    expect(events.at(-1)).toEqual({ kind: 'file-end' });
    expect(events.at(-2)).toEqual({ kind: 'block-end' });
    expect(events.filter((e) => e.kind === 'unknown')).toEqual([]);
    expect(events.filter((e) => e.kind === 'job-bounds')).toHaveLength(4);
    const speed = events.find((e) => e.kind === 'layer-speed');
    expect(speed).toMatchObject({ layer: 0, mmPerMin: 1500 });
    expect(events.find((e) => e.kind === 'layer-max-power')).toMatchObject({ layer: 0 });
    const maxPower = events.find((e) => e.kind === 'layer-max-power');
    if (maxPower?.kind !== 'layer-max-power') throw new Error('missing power');
    expect(maxPower.percent).toBeCloseTo(50, 1);
    // passes: 2 → the move/cut sequence repeats twice.
    const moves = events.filter((e) => e.kind === 'move');
    const cuts = events.filter((e) => e.kind === 'cut');
    expect(moves).toHaveLength(2);
    expect(cuts).toHaveLength(2);
    expect(moves[0]).toMatchObject({ xMm: 10, yMm: 20 });
    expect(cuts[0]).toMatchObject({ xMm: 30, yMm: 40 });
  });

  it('refuses raster groups and empty jobs with typed errors', () => {
    const empty = encodeRdJob({ groups: [] }, RUIDA_DEVICE);
    expect(!empty.ok && empty.error.kind).toBe('empty-job');
    const raster = encodeRdJob(
      { groups: [{ kind: 'raster' } as unknown as Job['groups'][number]] },
      RUIDA_DEVICE,
    );
    expect(!raster.ok && raster.error.kind).toBe('raster-unsupported');
  });
});

describe('ruida UDP session state machine', () => {
  it('frames datagrams with a 16-bit checksum over the payload', () => {
    const framed = frameDatagram(new Uint8Array([0x01, 0x02, 0xff]));
    expect([...framed]).toEqual([0x01, 0x02, 0x01, 0x02, 0xff]); // sum 0x0102
  });

  it('sends one packet per ACK and finishes', () => {
    const jobBytes = new Uint8Array(3000); // → 3 packets at 1470 max payload
    let state = createRuidaSession(jobBytes);
    let sent = 0;
    for (;;) {
      const step = stepRuidaSession(state);
      state = step.state;
      if (step.toSend === null) break;
      sent += 1;
      const acked = onRuidaResponse(state, RUIDA_ACK);
      state = acked.state;
    }
    expect(sent).toBe(3);
    expect(state.status).toBe('done');
  });

  it('retries on ERR then goes terminal when the budget is spent', () => {
    let state = createRuidaSession(new Uint8Array(10));
    const first = stepRuidaSession(state);
    state = first.state;
    expect(first.toSend).not.toBeNull();
    for (let i = 0; i < 3; i += 1) {
      const retry = onRuidaResponse(state, RUIDA_ERR);
      state = retry.state;
      expect(retry.toSend).not.toBeNull(); // same packet retransmitted
    }
    const dead = onRuidaResponse(state, RUIDA_ERR);
    expect(dead.state.status).toBe('errored');
    expect(dead.toSend).toBeNull();
  });
});

describe('ruidaDriver', () => {
  it('is file-only with every live capability off', () => {
    expect(ruidaDriver.capabilities.transport).toBe('file-only');
    expect(ruidaDriver.capabilities.jog).toBe('none');
    expect(ruidaDriver.capabilities.console).toBe(false);
    expect(ruidaDriver.realtime.statusQuery).toBeNull();
    expect(ruidaDriver.prepareConsoleCommand('anything').ok).toBe(false);
  });
});
