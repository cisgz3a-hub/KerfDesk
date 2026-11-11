// .egv export round trip (ADR-703): a project compiled through the shared
// prepareOutput pipeline, written as an .egv file, read back by the decoder the
// simulator uses, gives the burns the drawing asked for. NOT hardware-verified.

import { describe, expect, it } from 'vitest';
import { egvBody, LhyDecoder } from '../../__fixtures__/controllers/lihuiyu-decoder';
import { mmToLhySteps } from '../../core/controllers/lihuiyu/lhy-motion-plan';
import { K40_M2_NANO_PROFILE, K40_M3_NANO_PWM_PROFILE } from '../../core/devices/lihuiyu-profiles';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { EGV_HEADER, emitEgvFile } from './emit-egv';

function squareProject(power = 100, device = K40_M2_NANO_PROFILE): Project {
  return {
    ...createProject(),
    device,
    scene: {
      layers: [
        { ...createLayer({ id: '#000000', color: '#000000', mode: 'line' }), power, speed: 1200 },
      ],
      objects: [
        {
          kind: 'imported-svg',
          id: 'square',
          source: 'square.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: { ...IDENTITY_TRANSFORM, x: 40, y: 30 },
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                    { x: 0, y: 10 },
                    { x: 0, y: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function decodeFile(bytes: Uint8Array): LhyDecoder {
  const decoder = new LhyDecoder();
  decoder.writeStream(egvBody(bytes));
  return decoder;
}

describe('emitEgvFile', () => {
  it('writes the MeerK40t header, then a stream that decodes to the square', () => {
    const result = emitEgvFile(squareProject());
    if (!result.ok) throw new Error(result.messages.join(' '));
    expect(new TextDecoder().decode(result.bytes).startsWith(EGV_HEADER)).toBe(true);
    const decoder = decodeFile(result.bytes);
    const burns = decoder.burns();
    const corners = burns.map((m) => m.to);
    const s = (mm: number): number => mmToLhySteps(mm);
    for (const corner of [
      { x: s(50), y: s(30) },
      { x: s(50), y: s(40) },
      { x: s(40), y: s(40) },
      { x: s(40), y: s(30) },
    ]) {
      expect(corners).toContainEqual(corner);
    }
    expect(decoder.moves.filter((m) => !m.laser && m.program)).toHaveLength(0);
    expect([decoder.x, decoder.y]).toEqual([0, 0]);
    expect(decoder.speedCodes).toHaveLength(1);
  });

  it('carries the same stream the USB link sends, and a footprint around the burns', () => {
    const result = emitEgvFile(squareProject());
    if (!result.ok) throw new Error(result.messages.join(' '));
    expect(result.bytes.subarray(result.bytes.length - result.stream.length)).toEqual(
      result.stream,
    );
    expect(result.footprint.start).toEqual({ x: 0, y: 0 });
    expect(result.footprint.bounds.minX).toBe(mmToLhySteps(40));
    expect(result.footprint.bounds.maxY).toBe(mmToLhySteps(40));
  });

  it('warns that an M2 cannot set power, but still writes the file', () => {
    const result = emitEgvFile(squareProject(40));
    if (!result.ok) throw new Error(result.messages.join(' '));
    expect(result.advisories.map((issue) => issue.message).join(' ')).toMatch(/current knob/);
  });

  it('sends M3 PWM power as per mille of Full-power S', () => {
    const result = emitEgvFile(squareProject(50, K40_M3_NANO_PWM_PROFILE));
    if (!result.ok) throw new Error(result.messages.join(' '));
    expect(decodeFile(result.bytes).pwmPowers).toEqual([150]);
  });

  it('refuses a machine origin other than rear-left', () => {
    const result = emitEgvFile(
      squareProject(100, { ...K40_M2_NANO_PROFILE, origin: 'front-left' }),
    );
    expect(result.ok ? '' : result.messages.join(' ')).toMatch(/rear-left/i);
  });

  it('is deterministic and lists the K40 profiles in the catalog', () => {
    const a = emitEgvFile(squareProject());
    const b = emitEgvFile(squareProject());
    expect(a.ok && b.ok && a.bytes.join() === b.bytes.join()).toBe(true);
    expect(profileCatalogEntryById('k40-lihuiyu-m2-nano')?.profile.controllerKind).toBe('lihuiyu');
    expect(profileCatalogEntryById('k40-lihuiyu-m3-nano-pwm')?.profile.lihuiyuBoard).toBe('M3-pwm');
  });
});
