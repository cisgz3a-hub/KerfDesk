import { describe, expect, it } from 'vitest';
import {
  buildSmoothieFrameLines,
  buildSmoothieJogCommand,
  SMOOTHIE_FRAME_TOOL_OFF_LINES,
} from './commands';
import { prepareSmoothieConsoleCommand } from './console-command';
import { smoothiewareDriver } from './driver';
import { classifySmoothieResponse } from './response';

describe('classifySmoothieResponse', () => {
  it('classifies the Smoothie vocabulary', () => {
    expect(classifySmoothieResponse('ok')).toEqual({ kind: 'ok' });
    expect(classifySmoothieResponse('turning laser off and returning to auto mode')).toEqual({
      kind: 'ok',
    });
    expect(classifySmoothieResponse('laser manual state: off')).toMatchObject({ kind: 'unknown' });
    expect(classifySmoothieResponse('!!')).toMatchObject({ kind: 'error', code: null });
    expect(classifySmoothieResponse('error:Alarm lock')).toMatchObject({
      kind: 'error',
      code: null,
    });
    expect(classifySmoothieResponse('Smoothie command shell')).toMatchObject({ kind: 'welcome' });
    expect(classifySmoothieResponse('Smoothie Running @120MHz')).toMatchObject({
      kind: 'welcome',
    });
    expect(
      classifySmoothieResponse('<Idle|MPos:0.0000,0.0000,0.0000|WPos:0.0000,0.0000,0.0000>'),
    ).toMatchObject({ kind: 'status' });
  });

  // Controller audit SM-8. Smoothieware prints these on its own when it halts,
  // or before the command's own ok (Endstops.cpp L420-L430 and L895-L902,
  // KillButton.cpp L53-L64, USBSerial.cpp L302-L314, ZProbe.cpp L492-L496):
  // none of them answers a line.
  it('reads every ALARM: line as a code-less alarm event, not a terminal reply', () => {
    for (const line of [
      'ALARM: Hard limit +X',
      'ALARM: Kill button pressed - reset, $X or M999 to clear HALT',
      'ALARM: Abort during cycle',
      'ALARM: Homing fail',
      'ALARM: Probe fail',
    ]) {
      expect(classifySmoothieResponse(line)).toEqual({ kind: 'alarm', code: null, raw: line });
    }
    // Real replies stay terminal: the halted `!!`/`error:Alarm lock` and
    // GcodeDispatch's error lines (GcodeDispatch.cpp L158-L180, L385-L403).
    for (const line of ['!!', 'error:Alarm lock', 'Error: unknown', 'error:Unsupported command']) {
      expect(classifySmoothieResponse(line)).toMatchObject({
        kind: 'error',
        code: null,
        raw: line,
      });
    }
  });

  it('reads the M221 laser report as a response line for the Laser module probe', () => {
    for (const line of [
      'Laser power: 100.00 %, disable auto power: 0, PWM frequency: 50000.000000 Hz',
      'Laser power scale at 100.00 %',
    ]) {
      expect(classifySmoothieResponse(line)).toEqual({ kind: 'message', tag: 'LASER', body: line });
    }
  });

  // Controller audit SM-9: Kernel.cpp L206-L302 prints the live feed and
  // `L:`/`S:` only while running; at rest the first F component is the
  // requested feed.
  it('drops the resting requested feed and reads S and L from the running report', () => {
    const idle = classifySmoothieResponse(
      '<Idle|MPos:1.0000,2.0000,0.0000|WPos:1.0000,2.0000,0.0000|F:4000.0,100.0>',
    );
    expect(idle).toMatchObject({
      kind: 'status',
      report: { state: 'Idle', feed: null, spindle: null, laserPowerPercent: null },
    });
    const run = classifySmoothieResponse(
      '<Run|MPos:1.0000,2.0000,0.0000|WPos:1.0000,2.0000,0.0000|F:1500.0,1500.0,100.0|L:37.5000|S:0.5000>',
    );
    expect(run).toMatchObject({
      kind: 'status',
      report: { state: 'Run', feed: 1500, spindle: 0.5, laserPowerPercent: 37.5 },
    });
    // Without the Laser module Smoothieware reports the spindle S at rest too.
    const spindle = classifySmoothieResponse(
      '<Idle|MPos:0.0000,0.0000,0.0000|WPos:0.0000,0.0000,0.0000|F:4000.0,100.0|S:12000.00>',
    );
    expect(spindle).toMatchObject({ report: { feed: null, spindle: 12000 } });
  });

  it('reads the M115 identity reply as a message, not a reboot banner', () => {
    // GcodeDispatch prints FIRMWARE_NAME only in answer to M115; Smoothie's
    // greetings are `Smoothie` (USB attach) and `Smoothie Running @...` (boot).
    expect(
      classifySmoothieResponse(
        'FIRMWARE_NAME:Smoothieware, FIRMWARE_URL:http%3A//smoothieware.org, X-GRBL_MODE:0',
      ),
    ).toMatchObject({ kind: 'message', tag: 'FIRMWARE' });
  });

  it('completes the ack-less `version` shell command on its build line', () => {
    // SimpleShell version_command prints the build line, then "%d axis" and an
    // optional NOTICE line, and never `ok`.
    expect(
      classifySmoothieResponse(
        'Build version: edge-94de12c, Build date: Oct 28 2019 13:24:32, MCU: LPC1769, System Clock: 120MHz',
      ),
    ).toEqual({ kind: 'ok' });
    expect(classifySmoothieResponse('5 axis')).toMatchObject({ kind: 'unknown' });
    expect(classifySmoothieResponse('  CNC Build 5 axis')).toMatchObject({ kind: 'unknown' });
  });

  it('parses the classic comma-delimited status report, not only the pipe grammar', () => {
    // Older Smoothie builds emit GRBL-0.9-style reports where the field
    // separators are commas, same as the axis-triple separators. The pipe
    // parser sees one field and the DRO never updates (controllerIdle stuck).
    expect(
      classifySmoothieResponse('<Idle,MPos:1.500,2.000,3.000,WPos:0.500,1.000,2.000>'),
    ).toMatchObject({
      kind: 'status',
      report: { state: 'Idle', mPos: { x: 1.5, y: 2, z: 3 }, wPos: { x: 0.5, y: 1, z: 2 } },
    });
  });
});

describe('Smoothie command builders', () => {
  // Robot.cpp takes F on a G0 line as the seek rate every later bare G0
  // inherits; M120/M121 push and pop it, so a jog or frame F never becomes the
  // job's travel speed.
  it('builds relative jogs and absolute frame legs inside a Robot state push/pop', () => {
    expect(buildSmoothieJogCommand({ dx: 10, feed: 1000 })).toBe(
      'fire off\nM400\nM221 S0\nM5\nM9\nM120\nG21\nG91\nG0 X10.000 F1000\nG90\nM121',
    );
    const lines = buildSmoothieFrameLines({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 6000);
    expect(lines[0]).toBe('M120\n');
    expect(lines[1]).toBe('G21\n');
    expect(lines[2]).toBe('G90\n');
    expect(lines.filter((line) => line.startsWith('G0 '))).toHaveLength(5);
    expect(lines.at(-1)).toBe('M121\n');
  });

  it('keeps zero-valued axis words in absolute mode (X0 is a real destination)', () => {
    expect(buildSmoothieJogCommand({ dx: 0, dy: 50, feed: 1000, relative: false })).toBe(
      'fire off\nM400\nM221 S0\nM5\nM9\nM120\nG21\nG90\nG0 X0.000 Y50.000 F1000\nM121',
    );
  });
});

describe('prepareSmoothieConsoleCommand', () => {
  it('explains that Console and saved macros are both one-line commands', () => {
    expect(prepareSmoothieConsoleCommand('G0 X0\nM3')).toEqual({
      ok: false,
      reason: 'Console commands and saved macros must contain exactly one line.',
    });
  });

  it('blocks config writes, allows queries and M999 without gating', () => {
    expect(prepareSmoothieConsoleCommand('config-set sd laser_module_enable true').ok).toBe(false);
    expect(prepareSmoothieConsoleCommand('config-load').ok).toBe(false);
    const unlock = prepareSmoothieConsoleCommand('M999');
    expect(
      unlock.ok && !unlock.command.requiresIdle && !unlock.command.requiresNoActiveOperation,
    ).toBe(true);
    expect(unlock.ok && unlock.command.stateEffect).toBe('reference');
    const status = prepareSmoothieConsoleCommand('?');
    expect(status.ok && status.command.wire === '?').toBe(true);
    const gcode = prepareSmoothieConsoleCommand('G0 X10');
    expect(gcode.ok && gcode.command.requiresIdle).toBe(true);
    expect(gcode.ok && gcode.command.stateEffect).toBe('machine-state');
  });

  it('classifies Smoothieware setup mutations', () => {
    for (const [input, stateEffect] of [
      ['G28', 'reference'],
      // Homes in grbl mode and parks in the Reprap dialect: position changes either way.
      ['G28.2', 'reference'],
      ['G28.3 X0 Y0', 'reference'],
      ['$H', 'reference'],
      ['G92 X0 Y0', 'coordinates-xy'],
      ['G43.1 Z-3', 'tool'],
    ] as const) {
      const result = prepareSmoothieConsoleCommand(input);
      expect(result.ok && result.command.stateEffect).toBe(stateEffect);
    }
  });

  it('sends only the shell lines Smoothieware completes', () => {
    // SimpleShell prints ok for $G, $# and $H; `version` and `fire off` have
    // their own completion lines. Everything else would strand its ack.
    for (const input of ['version', 'fire off', '$G', '$#', '$H', 'M115', 'M114', '$Q']) {
      expect(prepareSmoothieConsoleCommand(input).ok).toBe(true);
    }
    for (const input of ['version', '$G', '$#']) {
      const result = prepareSmoothieConsoleCommand(input);
      expect(result.ok && result.command.stateEffect).toBe('read-only');
    }
    for (const input of ['help', 'mem', 'ls /sd', 'fire 20', 'reset', '$I', '$S', '$J X1', '$']) {
      const result = prepareSmoothieConsoleCommand(input);
      expect(result.ok ? null : result.reason).toMatch(/without an ok/);
    }
    const unlock = prepareSmoothieConsoleCommand('$X');
    expect(unlock.ok ? null : unlock.reason).toMatch(/M999/);
    const lowercaseGcode = prepareSmoothieConsoleCommand('m114');
    expect(lowercaseGcode.ok ? null : lowercaseGcode.reason).toMatch(/capitals/);
  });
});

describe('smoothiewareDriver', () => {
  it('does not advertise feed hold without transport and configuration proof', () => {
    expect(smoothiewareDriver.realtime).toEqual({
      statusQuery: '?',
      hold: null,
      resume: null,
      safetyDoor: null,
      softReset: '\x18',
      jogCancel: null,
    });
    expect(smoothiewareDriver.capabilities).toMatchObject({
      jog: 'gcode-relative',
      realtimePause: false,
      softStop: true,
      statusQuery: 'realtime-report',
      settings: 'none',
      unlock: true,
      sleep: false,
      wcs: 'g92-only',
    });
    // `$H`, not G28.2: G28.2 only parks on the default (Reprap-dialect) build.
    expect(smoothiewareDriver.commands.home).toBe('M400\nfire off\nM400\nM221 S0\nM5\nM9\n$H');
    expect(smoothiewareDriver.commands.unlock).toBe('M999');
    expect(smoothiewareDriver.commands.settingsQuery).toBeNull();
    expect(smoothiewareDriver.commands.stopLaserLines).toEqual(['M5', 'M9']);
    expect(smoothiewareDriver.commands.frameToolOffLines).toEqual(SMOOTHIE_FRAME_TOOL_OFF_LINES);
    expect(smoothiewareDriver.commands.frameToolOffLines).toEqual([
      'fire off',
      'M400',
      'M221 S0',
      'M5',
      'M9',
    ]);
  });

  it('settles with M400, not G4 P0.01 — G4 P is milliseconds on Smoothieware', () => {
    // Same instant-ack hazard CTL-02 fixed for Marlin: G4 P0.01 would clear the
    // streamer while motion still drains; M400 waits for the queue to empty.
    expect(smoothiewareDriver.commands.settleDwell).toBe('M400');
    expect(smoothiewareDriver.commands.settleDwell).not.toBe('G4 P0.01');
  });
});
