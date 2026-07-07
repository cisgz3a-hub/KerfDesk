import { describe, expect, it } from 'vitest';
import { buildSmoothieFrameLines, buildSmoothieJogCommand } from './commands';
import { prepareSmoothieConsoleCommand } from './console-command';
import { smoothiewareDriver } from './driver';
import { classifySmoothieResponse } from './response';

describe('classifySmoothieResponse', () => {
  it('classifies the Smoothie vocabulary', () => {
    expect(classifySmoothieResponse('ok')).toEqual({ kind: 'ok' });
    expect(classifySmoothieResponse('!!')).toMatchObject({ kind: 'error', code: null });
    expect(classifySmoothieResponse('error:Alarm lock')).toMatchObject({
      kind: 'error',
      code: null,
    });
    expect(classifySmoothieResponse('ALARM: Kill button pressed')).toMatchObject({
      kind: 'error',
    });
    expect(classifySmoothieResponse('Smoothie command shell')).toMatchObject({ kind: 'welcome' });
    expect(classifySmoothieResponse('FIRMWARE_NAME:Smoothieware')).toMatchObject({
      kind: 'welcome',
    });
    expect(
      classifySmoothieResponse('<Idle|MPos:0.0000,0.0000,0.0000|WPos:0.0000,0.0000,0.0000>'),
    ).toMatchObject({ kind: 'status' });
  });
});

describe('Smoothie command builders', () => {
  it('builds relative jogs and absolute frame legs', () => {
    expect(buildSmoothieJogCommand({ dx: 10, feed: 1000 })).toBe('G21\nG91\nG0 X10.000 F1000\nG90');
    const lines = buildSmoothieFrameLines({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 6000);
    expect(lines[0]).toBe('G21\n');
    expect(lines[1]).toBe('G90\n');
    expect(lines).toHaveLength(7);
  });

  it('keeps zero-valued axis words in absolute mode (X0 is a real destination)', () => {
    expect(buildSmoothieJogCommand({ dx: 0, dy: 50, feed: 1000, relative: false })).toBe(
      'G21\nG90\nG0 X0.000 Y50.000 F1000',
    );
  });
});

describe('prepareSmoothieConsoleCommand', () => {
  it('blocks config writes, allows queries and M999 without gating', () => {
    expect(prepareSmoothieConsoleCommand('config-set sd laser_module_enable true').ok).toBe(false);
    expect(prepareSmoothieConsoleCommand('config-load').ok).toBe(false);
    const unlock = prepareSmoothieConsoleCommand('M999');
    expect(
      unlock.ok && !unlock.command.requiresIdle && !unlock.command.requiresNoActiveOperation,
    ).toBe(true);
    const status = prepareSmoothieConsoleCommand('?');
    expect(status.ok && status.command.wire === '?').toBe(true);
    const gcode = prepareSmoothieConsoleCommand('G0 X10');
    expect(gcode.ok && gcode.command.requiresIdle).toBe(true);
  });
});

describe('smoothiewareDriver', () => {
  it('keeps GRBL realtime bytes but drops $-vocabulary and jog protocol', () => {
    expect(smoothiewareDriver.realtime).toEqual({
      statusQuery: '?',
      hold: '!',
      resume: '~',
      softReset: '\x18',
      jogCancel: null,
    });
    expect(smoothiewareDriver.capabilities).toMatchObject({
      jog: 'gcode-relative',
      realtimePause: true,
      softStop: true,
      statusQuery: 'realtime-report',
      settings: 'none',
      unlock: true,
      sleep: false,
      wcs: 'g92-only',
    });
    expect(smoothiewareDriver.commands.home).toBe('G28.2');
    expect(smoothiewareDriver.commands.unlock).toBe('M999');
    expect(smoothiewareDriver.commands.settingsQuery).toBeNull();
    expect(smoothiewareDriver.commands.stopLaserLines).toEqual(['M5', 'M9']);
  });
});
