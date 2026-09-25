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
    expect(classifyMarlinResponse('Error:G2/G3 bad parameters')).toEqual({
      kind: 'error',
      code: null,
      raw: 'Error:G2/G3 bad parameters',
    });
    expect(classifyMarlinResponse('start')).toMatchObject({ kind: 'welcome' });
    expect(classifyMarlinResponse('FIRMWARE_NAME:Marlin 2.1.2')).toMatchObject({
      kind: 'welcome',
    });
    expect(classifyMarlinResponse('echo:M112 Shutdown')).toMatchObject({
      kind: 'message',
      tag: 'echo',
    });
  });

  // MA-10: kill() prints this and then waits for RESET or a power cycle
  // (MarlinCore.cpp L889-L957).
  it('marks the kill() error as a halted controller', () => {
    expect(classifyMarlinResponse('Error:Printer halted. kill() called!')).toEqual({
      kind: 'error',
      code: null,
      raw: 'Error:Printer halted. kill() called!',
      halted: true,
    });
  });

  // MA-12: parser.cpp L390-L392 echoes the command, gcode.cpp L1122 then
  // answers the line with `ok`.
  it('classifies "Unknown command" with the command and the build option it needs', () => {
    expect(classifyMarlinResponse('echo:Unknown command: "M8"')).toEqual({
      kind: 'unknown-command',
      command: 'M8',
      raw: 'echo:Unknown command: "M8"',
      requirement: 'AIR_ASSIST (or COOLANT_FLOOD)',
    });
    expect(classifyMarlinResponse('echo:Unknown command: "M5 I"')).toMatchObject({
      command: 'M5 I',
      requirement: 'LASER_FEATURE (a laser cutter)',
    });
    expect(classifyMarlinResponse('echo:Unknown command: "M107"')).toMatchObject({
      requirement: 'a fan output (HAS_FAN)',
    });
    expect(classifyMarlinResponse('echo:Unknown command: "$$"')).toMatchObject({
      kind: 'unknown-command',
      command: '$$',
      requirement: null,
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

  it('keeps zero-valued axis words in absolute mode (X0 is a real destination)', () => {
    expect(buildMarlinJogCommand({ dx: 0, dy: 50, feed: 1000, relative: false })).toBe(
      'G21\nG90\nG0 X0.000 Y50.000 F1000',
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
  it('explains that Console and saved macros are both one-line commands', () => {
    expect(prepareMarlinConsoleCommand('G0 X0\nM3')).toEqual({
      ok: false,
      reason: 'Console commands and saved macros must contain exactly one line.',
    });
  });

  // MA-5: queue.cpp answers nothing for a line left empty once `;` comments
  // are removed, so its owed `ok` would block every later command.
  it('refuses a line that is only a comment, and keeps one with a command', () => {
    for (const input of ['; note', '(note)', ' (a) ; b ']) {
      const result = prepareMarlinConsoleCommand(input);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toMatch(/only a comment/);
    }
    const commented = prepareMarlinConsoleCommand('M114 ; where');
    expect(commented.ok && commented.command.wire).toBe('M114 ; where\n');
  });

  it('blocks persistent writes, allows queries without idle, never gates M112', () => {
    expect(prepareMarlinConsoleCommand('M500').ok).toBe(false);
    expect(prepareMarlinConsoleCommand('M502').ok).toBe(false);
    const query = prepareMarlinConsoleCommand('M114');
    expect(query.ok && !query.command.requiresIdle).toBe(true);
    const estop = prepareMarlinConsoleCommand('M112');
    expect(
      estop.ok && !estop.command.requiresIdle && !estop.command.requiresNoActiveOperation,
    ).toBe(true);
    expect(estop.ok && estop.command.stateEffect).toBe('reference');
    const gcode = prepareMarlinConsoleCommand('G0 X10');
    expect(gcode.ok && gcode.command.requiresIdle).toBe(true);
    expect(gcode.ok && gcode.command.stateEffect).toBe('machine-state');
  });

  it('classifies Marlin setup mutations', () => {
    for (const [input, stateEffect] of [
      ['G28', 'reference'],
      ['M92 X80', 'configuration'],
      ['M206 Z1', 'configuration'],
      ['M851 Z-1.5', 'tool'],
      ['G92 Z0', 'coordinates-z'],
    ] as const) {
      const result = prepareMarlinConsoleCommand(input);
      expect(result.ok && result.command.stateEffect).toBe(stateEffect);
    }
  });
});

describe('marlinDriver', () => {
  it('has no realtime bytes and declares the reduced capability set', () => {
    expect(marlinDriver.realtime).toEqual({
      statusQuery: null,
      hold: null,
      resume: null,
      safetyDoor: null,
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
    expect(marlinDriver.commands.stopLaserLines).toEqual(['M5 I', 'M107']);
    expect(marlinDriver.commands.frameToolOffLines).toEqual(['M5 I', 'M107']);
    expect(marlinDriver.defaultBaudRate).toBe(250000);
  });

  // MA-7: M107 first (no synchronize), M410 acted on when read, then M5 I.
  it('stops with the quickstop sequence', () => {
    expect(marlinDriver.commands.quickStopLines).toEqual(['M107', 'M410', 'M5 I']);
    expect(marlinDriver.capabilities.streamPauseBeamOff).toBe(true);
  });

  // MA-10: after kill() Marlin needs its reset button or a power cycle.
  it('tells the operator how to recover from the M112 emergency stop', () => {
    const m112 = marlinDriver.consoleQuickCommands.find((entry) => entry.command === 'M112');
    expect(m112?.hint).toBe(
      "EMERGENCY STOP (halts the firmware; press the controller's reset button or power-cycle it, then reconnect)",
    );
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

  it('warns when a grbl-dollar firmware has not reported $30/$32 yet', () => {
    const project = {
      device: DEFAULT_DEVICE_PROFILE,
    } as unknown as Parameters<typeof runControllerReadiness>[0];
    const result = runControllerReadiness(project, null, 'grbl-dollar');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'power-scale-unverified',
      'laser-mode-unverified',
    ]);
  });
});
