// The red-light Frame never asks the laser source to fire (ADR-704): it holds
// no Mark, no Laser On Point and no power, frequency or pulse word, and never
// raises the program port bit 0 — only the pointer's port bit (MeerK40t
// light_mode, controller.py L534-561; livelightjob.py L218-267).

import { describe, expect, it } from 'vitest';
import { DEFAULT_GALVO_SETUP } from '../../devices/galvo-setup';
import { decodeLmcProgram, lmcSettingsWritten } from './lmc-decoder';
import { lmcFootprintCorners, type LmcFootprint } from './lmc-footprint';
import { encodeLmcFrameJob, FRAME_TRACE_SECONDS, frameLoops } from './lmc-frame-job';

const FOOTPRINT: LmcFootprint = { minGx: 30000, minGy: 31000, maxGx: 36000, maxGy: 35000 };
const LASER_WORDS = [
  'MarkCurrent',
  'MarkPowerRatio',
  'MarkFreq',
  'QSwitchPeriod',
  'SetCo2FPK',
  'FiberYLPMPulseWidth',
  'MarkSpeed',
];

describe('encodeLmcFrameJob', () => {
  it('traces the footprint with the pointer and contains no laser-on', () => {
    const frame = encodeLmcFrameJob(FOOTPRINT, DEFAULT_GALVO_SETUP, 110);
    if (frame === null) throw new Error('no frame');
    const { ops, ended } = decodeLmcProgram(frame.lists);
    expect(ended).toBe(true);
    expect(ops.some((op) => op.op === 'mark' || op.op === 'laser-on-point')).toBe(false);
    for (const op of ops) if (op.op === 'port') expect(op.bits & 1).toBe(0);
    const settings = lmcSettingsWritten(ops);
    for (const word of LASER_WORDS) expect(settings.has(word)).toBe(false);
    // The pointer comes on only after the first jump, and is off at the end.
    const ports = ops
      .filter((op) => op.op === 'port')
      .map((op) => (op.op === 'port' ? op.bits : -1));
    expect(ports).toEqual([0, 1 << 8, 0]);
    const firstJump = ops.findIndex((op) => op.op === 'jump');
    const lightOn = ops.findIndex((op) => op.op === 'port' && op.bits !== 0);
    expect(firstJump).toBeLessThan(lightOn);
    // Every corner it visits is a footprint corner.
    const corners = lmcFootprintCorners(FOOTPRINT).map(({ gx, gy }) => `${gx},${gy}`);
    for (const op of ops) if (op.op === 'jump') expect(corners).toContain(`${op.gx},${op.gy}`);
    const jumps = ops.filter((op) => op.op === 'jump').length;
    expect(jumps).toBe(1 + 4 * frame.loops);
  });

  it('loops for about FRAME_TRACE_SECONDS at the red-light speed', () => {
    // 20,000 units round = 20000 / (65535 / 110) ≈ 33.6 mm; at 3000 mm/s ≈ 11.2 ms a loop.
    const loops = frameLoops(FOOTPRINT, 3000, 110);
    const loopSeconds = 20000 / (65535 / 110) / 3000;
    expect(loops).toBe(Math.ceil(FRAME_TRACE_SECONDS / loopSeconds));
  });

  it('holds the pointer on a single-point footprint instead of looping', () => {
    const point = { minGx: 32768, minGy: 32768, maxGx: 32768, maxGy: 32768 };
    const frame = encodeLmcFrameJob(point, DEFAULT_GALVO_SETUP, 110);
    const ops = decodeLmcProgram(frame?.lists ?? []).ops;
    const dwell = ops.reduce((sum, op) => sum + (op.op === 'delay' ? op.units : 0), 0);
    expect(dwell * 10).toBe(FRAME_TRACE_SECONDS * 1_000_000);
    expect(ops.some((op) => op.op === 'mark')).toBe(false);
  });
});
