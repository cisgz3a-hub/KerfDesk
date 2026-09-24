// Console text that would reach the controller as something other than text
// (controller audit 2026-09-23, transport-2). The oracle is firmware
// behaviour: GRBL-family controllers run bytes above 0x7F and control
// characters such as Ctrl-X as realtime commands before parsing the line.

import { describe, expect, it } from 'vitest';
import { consoleTextRefusal, normalizeConsoleSpaces } from './console-text';
import { prepareConsoleCommand } from './grbl/console-command';
import { prepareMarlinConsoleCommand } from './marlin/console-command';
import { prepareSmoothieConsoleCommand } from './smoothieware/console-command';

const NO_BREAK_SPACE = String.fromCharCode(0x00a0);
const THIN_SPACE = String.fromCharCode(0x2009);
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);
const DEGREE = String.fromCharCode(0x00b0);
const CTRL_X = String.fromCharCode(0x18);

const PREPARERS = [
  ['GRBL family', prepareConsoleCommand],
  ['Marlin', prepareMarlinConsoleCommand],
  ['Smoothieware', prepareSmoothieConsoleCommand],
] as const;

describe('Console text rule', () => {
  it('turns pasted Unicode spaces into plain spaces', () => {
    expect(
      normalizeConsoleSpaces(`G0${NO_BREAK_SPACE}X1${THIN_SPACE}Y2${IDEOGRAPHIC_SPACE}F100`),
    ).toBe('G0 X1 Y2 F100');
  });

  it('names a non-ASCII character and where it is', () => {
    expect(consoleTextRefusal(`G0 X1 (45${DEGREE} corner)`)).toBe(
      `Console commands must be plain ASCII: "${DEGREE}" (U+00B0) at column 10 would reach the controller as a realtime command, not text. Retype it without that character.`,
    );
  });

  it('refuses control characters such as Ctrl-X, a GRBL soft reset', () => {
    expect(consoleTextRefusal(`G0 X1${CTRL_X}`)).toMatch(
      /control characters \(U\+0018 at column 6\)/,
    );
  });

  it('keeps tabs and printable ASCII', () => {
    expect(consoleTextRefusal('G0\tX1 Y2 (plain comment)')).toBeNull();
  });
});

describe.each(PREPARERS)('%s Console preparer', (_name, prepare) => {
  it('sends a line pasted with a non-breaking space as plain ASCII', () => {
    const prepared = prepare(`G0${NO_BREAK_SPACE}X1`);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.command.normalized).toBe('G0 X1');
    expect(prepared.command.wire).toBe('G0 X1\n');
  });

  it('refuses a line whose comment would switch an accessory', () => {
    const prepared = prepare(`G0 X1 (45${DEGREE} corner)`);
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.reason).toContain(`"${DEGREE}" (U+00B0)`);
  });
});
