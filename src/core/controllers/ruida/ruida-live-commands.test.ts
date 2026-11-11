import { describe, expect, it } from 'vitest';
import { decodeRdStream } from '../../../__fixtures__/controllers/ruida-decoder';
import { encodeRdFrameJob, rdFootprint, sameRdFootprint } from './rd-frame-job';
import { writeRdJob } from './rd-job-writer';
import { planRdMotion } from './rd-motion-plan';
import {
  decodeRuidaMachineStatus,
  decodeRuidaReply,
  encodeRuidaReply,
  ruidaCommandDatagram,
  ruidaGetSetting,
  ruidaStatusBusy,
  RUIDA_MEM_CURRENT_X,
  RUIDA_MEM_MACHINE_STATUS,
  RUIDA_STOP_PROCESS,
} from './ruida-live-commands';
import { frameDatagram } from './ruida-udp-session';
import { swizzleBytes, unswizzleBytes } from './swizzle';
import type { CutGroup } from '../../job';

describe('Ruida live commands (meerk40t d511944e rdjob.py)', () => {
  it('frames Stop Process as its own checksummed datagram', () => {
    const datagram = ruidaCommandDatagram(RUIDA_STOP_PROCESS);
    expect(datagram).toEqual(frameDatagram(swizzleBytes([0xd8, 0x01])));
    expect([...unswizzleBytes(datagram.slice(2))]).toEqual([0xd8, 0x01]);
  });

  it('reads memory with DA 00 and a 7-bit address', () => {
    expect(ruidaGetSetting(RUIDA_MEM_MACHINE_STATUS)).toEqual([0xda, 0x00, 0x04, 0x00]);
    expect(ruidaGetSetting(RUIDA_MEM_CURRENT_X)).toEqual([0xda, 0x00, 0x04, 0x21]);
  });

  it('decodes DA 01 replies, unsigned and signed, for either magic', () => {
    for (const magic of [0x88, 0x11]) {
      expect(decodeRuidaReply(encodeRuidaReply(RUIDA_MEM_CURRENT_X, -2_000, magic), magic)).toEqual(
        { address: RUIDA_MEM_CURRENT_X, value: 2 ** 35 - 2_000, signed: -2_000 },
      );
      const status = decodeRuidaReply(
        encodeRuidaReply(RUIDA_MEM_MACHINE_STATUS, 0x01000001, magic),
        magic,
      );
      expect(status?.value).toBe(0x01000001);
    }
  });

  it('refuses anything but a full DA 01 reply', () => {
    expect(decodeRuidaReply(swizzleBytes([0xcc]))).toBeNull();
    expect(decodeRuidaReply(swizzleBytes([0xda, 0x01, 0x04, 0x00, 0, 0]))).toBeNull();
    expect(decodeRuidaReply(swizzleBytes([0xda, 0x00, 0x04, 0x00, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('reads the three status bits meerk40t has identified', () => {
    expect(decodeRuidaMachineStatus(0)).toMatchObject({
      moving: false,
      partEnd: false,
      jobRunning: false,
    });
    expect(ruidaStatusBusy(decodeRuidaMachineStatus(0))).toBe(false);
    expect(decodeRuidaMachineStatus(0x01000000).moving).toBe(true);
    expect(decodeRuidaMachineStatus(0x00000002).partEnd).toBe(true);
    expect(decodeRuidaMachineStatus(0x00000001).jobRunning).toBe(true);
    // Bits above 32 do not alias into the identified ones.
    expect(ruidaStatusBusy(decodeRuidaMachineStatus(2 ** 33))).toBe(false);
  });
});

describe('the Ruida network Frame job', () => {
  const group: CutGroup = {
    kind: 'cut',
    layerId: 'l',
    color: '#ff0000',
    power: 80,
    speed: 1200,
    passes: 1,
    airAssist: true,
    segments: [
      {
        polyline: [
          { x: 10, y: 20 },
          { x: 40, y: 25 },
        ],
      },
    ],
  } as unknown as CutGroup;
  const motion = planRdMotion([group]);

  it('traces the job’s bounds with travel moves only, at zero power and no air', () => {
    const footprint = rdFootprint(motion, 'anchor-point');
    if (footprint === null) throw new Error('no footprint');
    const events = decodeRdStream(encodeRdFrameJob(footprint));
    expect(events.filter((event) => event.kind === 'cut')).toEqual([]);
    expect(events.filter((event) => event.kind === 'unknown')).toEqual([]);
    expect(events.filter((event) => event.kind === 'move')).toEqual([
      { kind: 'move', xMm: 10, yMm: 20 },
      { kind: 'move', xMm: 40, yMm: 20 },
      { kind: 'move', xMm: 40, yMm: 25 },
      { kind: 'move', xMm: 10, yMm: 25 },
      { kind: 'move', xMm: 10, yMm: 20 },
    ]);
    expect(events).toContainEqual({ kind: 'reference-point', mode: 'anchor-point' });
    expect(events).toContainEqual({ kind: 'air-assist', on: false });
    for (const event of events)
      if (event.kind === 'layer-power' || event.kind === 'part-power')
        expect(event.percent).toBe(0);
  });

  it('carries the job’s own header bounds, so the controller places both alike', () => {
    const footprint = rdFootprint(motion, 'machine-zero');
    if (footprint === null) throw new Error('no footprint');
    const bounds = (bytes: Uint8Array) =>
      decodeRdStream(bytes).filter((event) => event.kind === 'job-bounds');
    const job = swizzleBytes(writeRdJob(motion, 'machine-zero'));
    expect(bounds(job)).toHaveLength(4);
    expect(bounds(encodeRdFrameJob(footprint))).toEqual(bounds(job));
  });

  it('matches footprints only on equal bounds and reference mode', () => {
    const a = rdFootprint(motion, 'machine-zero');
    expect(sameRdFootprint(a, rdFootprint(motion, 'machine-zero'))).toBe(true);
    expect(sameRdFootprint(a, rdFootprint(motion, 'anchor-point'))).toBe(false);
    expect(sameRdFootprint(a, null)).toBe(false);
    expect(rdFootprint([], 'machine-zero')).toBeNull();
  });
});
