import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../devices';
import { runControllerReadiness } from '../../preflight';
import { buildMarlinFrameLines, buildMarlinJogCommand } from './commands';
import { prepareMarlinConsoleCommand } from './console-command';
import { marlinDriver } from './driver';
import { classifyMarlinResponse, parseMarlinPositionReport } from './response';

describe('classifyMarlinResponse', () => {
  it('classifies the core Marlin vocabulary', () => {
    expect(classifyMarlinResponse('ok')).toEqual({ kind: 'ok' });
    expect(classifyMarlinResponse('ok P15 B3')).toEqual({ kind: 'ok' });
    expect(classifyMarlinResponse('ok T:22.5 /0.0')).toEqual({ kind: 'ok' });
    expect(classifyMarlinResponse('echo:busy: processing')).toEqual({ kind: 'busy' });
    expect(classifyMarlinResponse('Resend: 42')).toEqual({ kind: 'resend', line: 42 });
    expect(classifyMarlinResponse('Error:Printer halted. kill() called!')).toMatchObject({
      kind: 'error',
      code: null,
    });
    expect(classifyMarlinResponse('start')).toMatchObject({ kind: 'welcome' });
    expect(classifyMarlinResponse('FIRMWARE_NAME:Marlin 2.1.2')).toMatchObject({
      kind: 'welcome',
    });
    expect(classifyMarlinResponse('echo:Unknown command: "$$"')).toMatchObject({
      kind: 'message',
      tag: 'echo',
    });
  });

  it('parses M114 position lines into Idle status reports', () => {
    const report = parseMarlinPositionReport('X:10.50 Y:5.00 Z:0.00 E:0.00 Count X:840 Y:400 Z:0');
    expect(report).toMatchObject({ state: 'Idle', mPos: { x: 10.5, y: 5, z: 0 }, wco: null });
    expect(classifyMarlinResponse('X:1.00 Y:2.00 Z:3.00 E:0.00 Count X:0 Y:0 Z:0')).toMatchObject({
      kind: 'status',
    });
    expect(parseMarlinPositionReport('not a position')).toBeNull();
  });
});

describe('Marlin command builders', () => {
  it('builds a relative jog as G21 / G91 / G0 / G90 lines', () => {
    expect(buildMarlinJogCommand({ dx: 10, feed: 1000 })).toBe('G21\nG91\nG0 X10.000 F1000\nG90');
    expect(buildMarlinJogCommand({ dy: -0.1, dz: 1, feed: 500 })).toBe(
      'G21\nG91\nG0 Y-0.100 Z1.000 F500\nG90',
    );
  });

  it('builds framing as G21+G90 leads plus five absolute G0 legs', () => {
    const lines = buildMarlinFrameLines({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 6000);
    expect(lines[0]).toBe('G21\n');
    expect(lines[1]).toBe('G90\n');
    expect(lines.slice(2)).toEqual([
      'G0 X0.000 Y0.000 F6000\n',
      'G0 X20.000 Y0.000 F6000\n',
      'G0 X20.000 Y10.000 F6000\n',
      'G0 X0.000 Y10.000 F6000\n',
      'G0 X0.000 Y0.000 F6000\n',
    ]);
  });
});

describe('prepareMarlinConsoleCommand', () => {
  it('blocks persistent writes, allows queries without idle, never gates M112', () => {
    expect(prepareMarlinConsoleCommand('M500').ok).toBe(false);
    expect(prepareMarlinConsoleCommand('M502').ok).toBe(false);
    const query = prepareMarlinConsoleCommand('M114');
    expect(query.ok && !query.command.requiresIdle).toBe(true);
    const estop = prepareMarlinConsoleCommand('M112');
    expect(
      estop.ok && !estop.command.requiresIdle && !estop.command.requiresNoActiveOperation,
    ).toBe(true);
    const gcode = prepareMarlinConsoleCommand('G0 X10');
    expect(gcode.ok && gcode.command.requiresIdle).toBe(true);
  });
});

describe('marlinDriver', () => {
  it('has no realtime bytes and declares the reduced capability set', () => {
    expect(marlinDriver.realtime).toEqual({
      statusQuery: null,
      hold: null,
      resume: null,
      softReset: null,
      jogCancel: null,
    });
    expect(marlinDriver.capabilities).toMatchObject({
      jog: 'gcode-relative',
      jogCancel: false,
      realtimePause: false,
      softStop: false,
      statusQuery: 'queued-poll',
      settings: 'none',
      unlock: false,
      sleep: false,
      wcs: 'g92-only',
      homing: true,
    });
    expect(marlinDriver.commands.home).toBe('G28 X Y');
    expect(marlinDriver.commands.settleDwell).toBe('M400');
    expect(marlinDriver.commands.queuedStatusQuery).toBe('M114');
    expect(marlinDriver.commands.stopLaserLines).toEqual(['M5', 'M107']);
    expect(marlinDriver.defaultBaudRate).toBe(250000);
  });
});

describe('controller readiness without $-settings (Marlin)', () => {
  it('passes with an explicit power-scale-unverified warning', () => {
    const project = {
      device: DEFAULT_DEVICE_PROFILE,
    } as unknown as Parameters<typeof runControllerReadiness>[0];
    const result = runControllerReadiness(project, null, 'none');
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('power-scale-unverified');
  });

  it('still enforces $30/$32 proof for grbl-dollar firmwares', () => {
    const project = {
      device: DEFAULT_DEVICE_PROFILE,
    } as unknown as Parameters<typeof runControllerReadiness>[0];
    const result = runControllerReadiness(project, null, 'grbl-dollar');
    expect(result.ok).toBe(false);
  });
});
