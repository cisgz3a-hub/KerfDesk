// Controller audit SM-3/SM-2: the `M221` Laser module probe. Reply texts are
// Laser.cpp L198-L202 at edge 38e2cc08 (971eb8cf, 2021-06-15, and later) and
// the pre-971eb8cf `Laser power scale at` report (04197132, 2016-08-28).

import { describe, expect, it } from 'vitest';
import { smoothiewareDriver } from './driver';
import {
  parseSmoothieLaserReport,
  smoothieDriverWithoutLaserModule,
  SMOOTHIE_NO_LASER_MODULE_FIRE_REASON,
} from './laser-module';

describe('parseSmoothieLaserReport', () => {
  it('reads a current edge report as a loaded module with M221 P', () => {
    expect(
      parseSmoothieLaserReport([
        'Laser power: 100.00 %, disable auto power: 0, PWM frequency: 50000.000000 Hz',
      ]),
    ).toEqual({ module: 'loaded', constantPowerMode: true });
  });

  it('reads the pre-2021-06-15 report as a loaded module without M221 P', () => {
    expect(parseSmoothieLaserReport(['Laser power scale at  50.00 %'])).toEqual({
      module: 'loaded',
      constantPowerMode: false,
    });
  });

  it('reads a bare ok (or an Extruder flow report) as no Laser module', () => {
    expect(parseSmoothieLaserReport([])).toEqual({ module: 'absent', constantPowerMode: null });
    expect(parseSmoothieLaserReport(['Flow rate at 100.00 %'])).toEqual({
      module: 'absent',
      constantPowerMode: null,
    });
  });

  it('is the driver probe, sent as M221 with no argument', () => {
    expect(smoothiewareDriver.laserModuleProbe?.command).toBe('M221');
  });
});

describe('smoothieDriverWithoutLaserModule', () => {
  const driver = smoothieDriverWithoutLaserModule(smoothiewareDriver);

  it('drops `fire off`, which nothing would answer, from jog, Frame and Home', () => {
    expect(driver.commands.frameToolOffLines).toEqual(['M400', 'M221 S0', 'M5', 'M9']);
    expect(driver.commands.home).toBe('M400\nM400\nM221 S0\nM5\nM9\n$H');
    expect(driver.commands.buildJog({ dx: 10, feed: 1000 })).toBe(
      'M400\nM221 S0\nM5\nM9\nM120\nG21\nG91\nG0 X10.000 F1000\nG90\nM121',
    );
  });

  it('refuses fire commands in the Console and keeps every other line', () => {
    expect(driver.prepareConsoleCommand('fire off')).toEqual({
      ok: false,
      reason: SMOOTHIE_NO_LASER_MODULE_FIRE_REASON,
    });
    expect(driver.prepareConsoleCommand('M114')).toEqual(
      smoothiewareDriver.prepareConsoleCommand('M114'),
    );
  });

  it('keeps the rest of the driver unchanged', () => {
    expect(driver.kind).toBe('smoothieware');
    expect(driver.capabilities).toBe(smoothiewareDriver.capabilities);
    expect(driver.commands.stopLaserLines).toEqual(['M5', 'M9']);
    expect(driver.laserModuleProbe).toBe(smoothiewareDriver.laserModuleProbe);
  });
});
