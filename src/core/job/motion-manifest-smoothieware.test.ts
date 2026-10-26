import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { buildExecutablePlan } from '../execution-plan/build-executable-plan';
import { laserPowerControlForDevice } from '../gcode-view';
import { grblStrategy } from '../output/grbl-strategy';
import { smoothiewareStrategy } from '../output/smoothieware-strategy';
import {
  runSmoothieLines,
  powerUpSmoothie,
} from '../../__fixtures__/controllers/smoothie-laser-power-model';
import type { Job } from './job';
import { buildMotionManifest } from './motion-manifest';

// Rolling audit v2 03-P2-8 (ADR-096 Amendment 1): Smoothieware's laser module
// fires on any G1/G2/G3 whose S is above zero while the M221 power scale is
// above zero; M3/M4/M5 change nothing. The manifest reads the program that
// way on Smoothieware, so the live view, burn trail and camera check see the
// burns, and agrees with the independent power oracle.

const SMOOTHIE_DEVICE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'smoothieware',
  maxPowerS: 1,
};

const square: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 40,
      speed: 1200,
      passes: 1,
      airAssist: false,
      segments: [
        {
          closed: true,
          polyline: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 30, y: 30 },
            { x: 10, y: 30 },
            { x: 10, y: 10 },
          ],
        },
      ],
    },
  ],
};

function kinds(gcode: string, device: DeviceProfile): ReadonlyArray<string> {
  return buildMotionManifest(gcode, {
    machineKind: 'laser',
    laserPowerControl: laserPowerControlForDevice(device),
  }).blocks.map((block) => block.kind);
}

describe('motion manifest on Smoothieware (03-P2-8)', () => {
  it('reads a Smoothieware burn as process, as GRBL output reads', () => {
    const smoothie = smoothiewareStrategy.emit(square, SMOOTHIE_DEVICE);
    const grbl = grblStrategy.emit(square, DEFAULT_DEVICE_PROFILE);

    expect(kinds(grbl, DEFAULT_DEVICE_PROFILE)).toEqual([
      'travel',
      'process',
      'process',
      'process',
      'process',
      'park',
    ]);
    expect(kinds(smoothie, SMOOTHIE_DEVICE)).toEqual(kinds(grbl, DEFAULT_DEVICE_PROFILE));
  });

  it('matches the Smoothieware power oracle burn for burn', () => {
    const smoothie = smoothiewareStrategy.emit(square, SMOOTHIE_DEVICE);
    const oracle = runSmoothieLines(powerUpSmoothie(), smoothie);
    const manifest = buildMotionManifest(smoothie, {
      machineKind: 'laser',
      laserPowerControl: 'smoothieware',
    });
    const process = manifest.blocks.filter((block) => block.kind === 'process');

    expect(process.map((block) => block.rawLineIndex + 1)).toEqual(
      oracle.burns.filter((burn) => burn.power > 0).map((burn) => burn.line),
    );
    expect(manifest.firstProcessPoint).toEqual({ x: 10, y: 10, z: 0 });
  });

  it('keeps every move dark once M221 S0 drops the power scale', () => {
    const manifest = buildMotionManifest(
      ['fire off', 'M400', 'M221 S0', 'G1 X10 Y0 S0.5 F600', 'M221 S100 P0', 'G1 X20 Y0'].join(
        '\n',
      ),
      { machineKind: 'laser', laserPowerControl: 'smoothieware' },
    );

    expect(manifest.blocks.map((block) => block.kind)).toEqual(['travel', 'process']);
  });

  it('never reads a G0 as a burn, whatever its S', () => {
    const manifest = buildMotionManifest(['M221 S100 P0', 'G0 X10 Y0 S0.5'].join('\n'), {
      machineKind: 'laser',
      laserPowerControl: 'smoothieware',
    });

    expect(manifest.blocks.map((block) => block.kind)).toEqual(['travel']);
  });

  it('gives the executable plan the burned length', () => {
    const smoothie = smoothiewareStrategy.emit(square, SMOOTHIE_DEVICE);
    const plan = buildExecutablePlan(smoothie, {
      machineKind: 'laser',
      controller: 'smoothieware',
    });

    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    const processMm = plan.plan.motions
      .filter((motion) => motion.intent === 'process')
      .reduce((sum, motion) => sum + motion.lengthMm, 0);
    expect(processMm).toBeCloseTo(80, 3);
  });
});
