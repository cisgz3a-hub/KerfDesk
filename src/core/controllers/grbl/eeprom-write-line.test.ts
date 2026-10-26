// ADR-644: GRBL's interface notes say EEPROM-writing lines (G10 L2/L20,
// G28.1, G30.1, `$` setting writes) are safe only with send-response streaming.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md

import { describe, expect, it } from 'vitest';
import {
  isBuildInfoWriteLine,
  isEepromWriteLine,
  isStoredSettingWriteLine,
} from './eeprom-write-line';
import { createStreamer, onAck, step } from './streamer';

describe('isEepromWriteLine', () => {
  it.each([
    'G10 L20 P1 X0 Y0',
    'G10L20P1X0Y0',
    'G 10 L 2 P0 X5',
    'g10l2p1x0',
    'G010.0 L20 P1 X0',
    'G28.1',
    'G30.1 X5',
    'G21 G28.1',
    '$10=0',
    '$N0=G21',
    '$I=shop laser',
    '$RST=*',
    '$130 = 400',
  ])('treats %s as an EEPROM write', (line) => {
    expect(isEepromWriteLine(line)).toBe(true);
  });

  it.each([
    'G28',
    'G30',
    'G0 X10.1 Y28.1',
    'G1 X100 F600',
    'G54',
    'G0 X0 ; G10 L2 P1 X5',
    '(G28.1) G0 X0',
    '$J=G91 X10 F600',
    '$H',
    '$X',
    '$$',
    'M5',
  ])('does not treat %s as an EEPROM write', (line) => {
    expect(isEepromWriteLine(line)).toBe(false);
  });
});

// ADR-648: setting writes (`$key=value`, FluidNC's `[key]value`) and FluidNC's
// `$NVX` erase retire a kept `$$` snapshot; only `$I=` and `$RST=` change what
// `$I` reports. The firmware drops whitespace before parsing a line.
describe('isStoredSettingWriteLine and isBuildInfoWriteLine', () => {
  it.each([
    '$I=shop laser',
    '$I =shop laser',
    '$ I = shop',
    '$RST=*',
    '$RST = $',
    '$rst=#',
    '[RST]*',
    '/ $I=shop laser',
    '[I]shop laser',
  ])('treats %s as a build-info write', (line) => {
    expect(isStoredSettingWriteLine(line)).toBe(true);
    expect(isBuildInfoWriteLine(line)).toBe(true);
  });

  it.each([
    '$30=1000',
    '$130 = 400',
    '$N0=G21',
    '$NVX',
    '$Settings/Erase',
    '$nvx=1',
    '[13]1',
    '[ 13 ]1',
    '[NVX]',
    '/$30=500',
    '//$130=400',
  ])('treats %s as a setting write that leaves `$I` alone', (line) => {
    expect(isStoredSettingWriteLine(line)).toBe(true);
    expect(isBuildInfoWriteLine(line)).toBe(false);
  });

  it.each([
    '$I',
    '$$',
    '$J=G91 X1 F100',
    '$J =G91 X1 F100',
    '$Jog=G91 X1 F100',
    '[J]G91 X1 F100',
    '[ Jog ]G91 X1',
    'G10 L20 P1 X0',
    '($I=x) G0 X1',
    '$NVXY',
    '[13]',
    '[ 13 ] ',
  ])('does not treat %s as a setting write', (line) => {
    expect(isStoredSettingWriteLine(line)).toBe(false);
    expect(isBuildInfoWriteLine(line)).toBe(false);
  });
});

describe('streamer EEPROM sync point', () => {
  it('sends an EEPROM write alone, into an empty window, and waits for its ack', () => {
    let s = createStreamer('G0 X1\nG0 X2\nG10 L20 P1 X0 Y0\nG0 X3\nG0 X4\n');
    let r = step(s);
    expect(r.toSend).toBe('G0 X1\nG0 X2\n');
    s = r.state;
    // Lines before it are still in flight: the write waits.
    expect(step(s).toSend).toBe('');
    s = onAck(s, 'ok').state;
    expect(step(s).toSend).toBe('');
    s = onAck(s, 'ok').state;
    r = step(s);
    expect(r.toSend).toBe('G10 L20 P1 X0 Y0\n');
    s = r.state;
    // Nothing follows it until its reply.
    expect(step(s).toSend).toBe('');
    s = onAck(s, 'ok').state;
    r = step(s);
    expect(r.toSend).toBe('G0 X3\nG0 X4\n');
    expect(r.state.status).toBe('streaming');
  });

  it('keeps two consecutive writes apart', () => {
    let s = createStreamer('$10=0\n$N0=G21\n');
    let r = step(s);
    expect(r.toSend).toBe('$10=0\n');
    s = onAck(r.state, 'ok').state;
    r = step(s);
    expect(r.toSend).toBe('$N0=G21\n');
    expect(onAck(r.state, 'ok').state.status).toBe('done');
  });

  it('leaves a program without EEPROM writes batched as before', () => {
    const r = step(createStreamer('G21\nG90\nG28\nG0 X1\nM5\n'));
    expect(r.toSend).toBe('G21\nG90\nG28\nG0 X1\nM5\n');
  });

  it('matches the canonical bytes an external run sends (ADR-630)', () => {
    // normalize-external-program strips blanks and comments: `G10L20P1X0Y0`.
    let s = createStreamer('G21G90\nG0X10Y0\nG10L20P1X0Y0\nM4S500\nG1X20F600\nM5\n');
    let r = step(s);
    expect(r.toSend).toBe('G21G90\nG0X10Y0\n');
    s = onAck(onAck(r.state, 'ok').state, 'ok').state;
    r = step(s);
    expect(r.toSend).toBe('G10L20P1X0Y0\n');
    r = step(onAck(r.state, 'ok').state);
    expect(r.toSend).toBe('M4S500\nG1X20F600\nM5\n');
  });
});
