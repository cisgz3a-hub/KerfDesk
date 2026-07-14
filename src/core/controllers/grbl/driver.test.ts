// Byte-identity contract for the GRBL driver: every command and realtime
// string must equal the pre-ADR-094 constants, and the frame builder must
// reproduce the exact ui/state output it replaced. The lifecycle simulator
// tests enforce the same bytes end-to-end; this pins the source of truth.

import { describe, expect, it } from 'vitest';
import { grblDriver } from './driver';

describe('grblDriver', () => {
  it('exposes the GRBL v1.1 realtime bytes', () => {
    expect(grblDriver.realtime).toEqual({
      statusQuery: '?',
      hold: '!',
      resume: '~',
      softReset: '\x18',
      jogCancel: '\x85',
    });
  });

  it('exposes the GRBL line-command vocabulary byte-identically', () => {
    expect(grblDriver.commands.home).toBe('$H');
    expect(grblDriver.commands.unlock).toBe('$X');
    expect(grblDriver.commands.sleep).toBe('$SLP');
    expect(grblDriver.commands.settingsQuery).toBe('$$');
    expect(grblDriver.commands.queuedStatusQuery).toBeNull();
    expect(grblDriver.commands.stopLaserLines).toEqual(['M9']);
    expect(grblDriver.commands.settleDwell).toBe('G4 P0.01');
    expect(grblDriver.commands.setOriginHere).toBe('G92 X0 Y0');
    expect(grblDriver.commands.clearOrigin).toBe('G92.1');
    expect(grblDriver.commands.setPersistentOriginHere).toBe('G10 L20 P1 X0 Y0');
    expect(grblDriver.commands.clearPersistentOrigin).toBe('G10 L2 P1 X0 Y0');
  });

  it('builds jog commands through the shared builder', () => {
    expect(grblDriver.commands.buildJog({ dx: 10, feed: 1000 })).toBe('$J=G91 G21 X10.000 F1000');
    expect(grblDriver.commands.buildJog({ dy: -0.1, feed: 500, relative: true })).toBe(
      '$J=G91 G21 Y-0.100 F500',
    );
  });

  it('builds the five-line absolute frame perimeter, newline-terminated', () => {
    const lines = grblDriver.commands.buildFrameLines(
      { minX: 0, minY: 0, maxX: 20, maxY: 10 },
      6000,
    );
    expect(lines).toEqual([
      '$J=G90 G21 X0.000 Y0.000 F6000\n',
      '$J=G90 G21 X20.000 Y0.000 F6000\n',
      '$J=G90 G21 X20.000 Y10.000 F6000\n',
      '$J=G90 G21 X0.000 Y10.000 F6000\n',
      '$J=G90 G21 X0.000 Y0.000 F6000\n',
    ]);
  });

  it('classifies lines with the GRBL response classifier', () => {
    expect(grblDriver.classifyLine('ok')).toEqual({ kind: 'ok' });
    expect(grblDriver.classifyLine('ALARM:3')).toEqual({ kind: 'alarm', code: 3 });
    expect(grblDriver.classifyLine('$32=1')).toEqual({ kind: 'setting', id: 32, value: '1' });
    expect(grblDriver.classifyLine('Grbl 1.1f')).toMatchObject({ kind: 'welcome' });
    // Family banners must classify as welcome so detection can run on them.
    expect(grblDriver.classifyLine("GrblHAL 1.1f ['$' or '$HELP' for help]")).toMatchObject({
      kind: 'welcome',
    });
    expect(grblDriver.classifyLine('Grbl 3.7 [FluidNC v3.7.8]')).toMatchObject({
      kind: 'welcome',
    });
  });

  it('declares full GRBL capabilities so the UI renders unchanged', () => {
    expect(grblDriver.capabilities).toEqual({
      transport: 'serial',
      jog: 'native-jog',
      jogCancel: true,
      realtimePause: true,
      softStop: true,
      statusQuery: 'realtime-report',
      settings: 'grbl-dollar',
      unlock: true,
      sleep: true,
      wcs: 'g92-and-g10',
      homing: true,
      console: true,
      firmwareSetupPanel: 'grbl-laser',
      probing: true,
      cncJobs: true,
      lowPowerFire: true,
      overrides: true,
      startProtocol: 'grbl-live',
    });
  });

  it('flags $-lines as setup-only payloads and G-code as streamable', () => {
    expect(grblDriver.isSetupOnlyPayload('$X\n')).toBe(true);
    expect(grblDriver.isSetupOnlyPayload('G1 X10\n$H\n')).toBe(true);
    expect(grblDriver.isSetupOnlyPayload('G1 X10 F600 S100\n')).toBe(false);
  });
});
