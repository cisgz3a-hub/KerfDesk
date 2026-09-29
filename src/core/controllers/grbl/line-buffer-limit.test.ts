// The line-buffer counts against direct ports of the two firmware collection
// loops (controller audit S-3). GRBL:
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L113-L148
// grblHAL:
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L291-L328

import { describe, expect, it } from 'vitest';
import {
  findLineBufferOverflow,
  GRBL_LINE_BUFFER_CHARS,
  GRBLHAL_LINE_BUFFER_CHARS,
  grblhalStoredChars,
  grblStoredChars,
  lineBufferOverflowMessage,
} from './line-buffer-limit';

// gnea/grbl protocol_main_loop, one line: true when it answers error:11.
function grblFirmwareOverflows(line: string): boolean {
  const PAREN = 2;
  const SEMICOLON = 4;
  const OVERFLOW = 1;
  let flags = 0;
  let counter = 0;
  for (const c of line) {
    if (flags !== 0) {
      if (c === ')' && (flags & PAREN) !== 0) flags &= ~PAREN;
    } else if (c <= ' ' || c === '/') {
      // Whitespace, control characters and block delete are thrown away.
    } else if (c === '(') {
      flags |= PAREN;
    } else if (c === ';') {
      flags |= SEMICOLON;
    } else if (counter >= 80 - 1) {
      flags |= OVERFLOW;
    } else {
      counter += 1;
    }
  }
  return (flags & OVERFLOW) !== 0;
}

// grblHAL protocol_main_loop, one line: true when it answers error:11. An edit
// runs recheck_line, which clears every flag, overflow included (#L88-L92).
function grblhalFirmwareOverflows(line: string): boolean {
  let pos = 0;
  let overflow = false;
  for (const c of line) {
    const code = c.charCodeAt(0);
    if (code !== 0x08 && code <= (pos > 0 ? 0x1f : 0x20)) continue;
    if (code === 0x08 || code === 0x7f) {
      if (pos > 0) {
        pos -= 1;
        overflow = false;
      }
      continue;
    }
    overflow = pos >= 257 - 1;
    if (!overflow) pos += 1;
  }
  return overflow;
}

// Deterministic lines over characters both counts model exactly (no realtime
// characters): G-code text with an occasional comment, tab or block delete.
function randomLines(count: number): ReadonlyArray<string> {
  const common = 'GXYSFgx0123456789.- ';
  const rare = '\t()/;$[\x08\x7f';
  let seed = 12345;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = (chars: string): string => chars[Math.floor(next() * chars.length)] ?? 'G';
  return Array.from({ length: count }, () => {
    const length = Math.floor(next() * 330);
    let line = '';
    for (let index = 0; index < length; index += 1) {
      line += pick(next() < 0.02 ? rare : common);
    }
    return line;
  });
}

function isSent(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== '' && !trimmed.startsWith(';');
}

describe('GRBL and grblHAL line-buffer limits', () => {
  it('matches both firmware loops on every sendable random line', () => {
    const lines = randomLines(3000).filter(isSent);
    // Both outcomes are well represented for both firmwares.
    for (const overflows of [grblFirmwareOverflows, grblhalFirmwareOverflows]) {
      const overflowing = lines.filter((line) => overflows(line.trim())).length;
      expect(overflowing).toBeGreaterThan(300);
      expect(lines.length - overflowing).toBeGreaterThan(300);
    }
    for (const line of lines) {
      const sent = line.trim();
      expect(findLineBufferOverflow(line, 'grbl-v1.1') !== null, sent).toBe(
        grblFirmwareOverflows(sent),
      );
      // A grblHAL edit is never reported, so there the count may only err low.
      const edited = /[\b\x7f]/.test(sent);
      expect(findLineBufferOverflow(line, 'grblhal') !== null, sent).toBe(
        edited ? false : grblhalFirmwareOverflows(sent),
      );
    }
  });

  it('keeps 79 significant characters on stock GRBL, not counting spaces or comments', () => {
    const atLimit = `G1 X${'1'.repeat(76)}`;
    expect(grblStoredChars(atLimit)).toBe(GRBL_LINE_BUFFER_CHARS);
    expect(findLineBufferOverflow(atLimit, 'grbl-v1.1')).toBeNull();
    expect(findLineBufferOverflow(`${atLimit} (a note) ; ${'c'.repeat(200)}`, 'grbl-v1.1')).toBe(
      null,
    );
    expect(grblStoredChars('g1 x1 / y2 ?!~')).toBe(6);
    // A backspace is a control character to GRBL; DEL is stored like text.
    expect(grblStoredChars('G1\x08\x7f')).toBe(3);
    expect(findLineBufferOverflow(`G21\n${atLimit}1`, 'grbl-v1.1')).toEqual({
      firmware: 'grbl-v1.1',
      lineNumber: 2,
      storedChars: 80,
      limit: GRBL_LINE_BUFFER_CHARS,
    });
  });

  it('keeps 256 characters on grblHAL, counting inner spaces and comments', () => {
    const atLimit = `G1 X${'1'.repeat(252)}`;
    expect(grblhalStoredChars(atLimit)).toBe(GRBLHAL_LINE_BUFFER_CHARS);
    expect(findLineBufferOverflow(`  ${atLimit}\r`, 'grblhal')).toBeNull();
    expect(grblhalStoredChars('G1 X1 ; note')).toBe(12);
    // Leading whitespace and control characters are dropped.
    expect(grblhalStoredChars(' \tG1\tX1')).toBe(4);
    // A backspace or DEL edits the line and clears grblHAL's overflow flag.
    expect(findLineBufferOverflow(`G1 X${'1'.repeat(300)}\x7f`, 'grblhal')).toBeNull();
    expect(findLineBufferOverflow(`; header\n${atLimit} `, 'grblhal')).toBeNull();
    expect(findLineBufferOverflow(`; header\n${atLimit}1`, 'grblhal')).toEqual({
      firmware: 'grblhal',
      lineNumber: 2,
      storedChars: 257,
      limit: GRBLHAL_LINE_BUFFER_CHARS,
    });
  });

  it('counts the parts a carriage return splits a line into on their own', () => {
    const half = `G1 X${'1'.repeat(40)}`;
    expect(findLineBufferOverflow(`${half}\r${half}`, 'grbl-v1.1')).toBeNull();
    expect(findLineBufferOverflow(`${half}\r${half}${'1'.repeat(40)}`, 'grbl-v1.1')).toMatchObject({
      lineNumber: 1,
      storedChars: 83,
    });
  });

  it('never checks lines the streamer does not send, or other controllers', () => {
    const longComment = `; ${'c'.repeat(400)}`;
    expect(findLineBufferOverflow(longComment, 'grblhal')).toBeNull();
    expect(findLineBufferOverflow(`\n\n${' '.repeat(300)}\n`, 'grblhal')).toBeNull();
    const long = `G1 X${'1'.repeat(300)}`;
    for (const kind of [undefined, 'fluidnc', 'marlin', 'smoothieware', 'ruida'] as const) {
      expect(findLineBufferOverflow(long, kind)).toBeNull();
    }
  });

  it('names the line, its count and the firmware limit', () => {
    const grbl = findLineBufferOverflow(`G21\nG1 X${'1'.repeat(77)}`, 'grbl-v1.1');
    const grblhal = findLineBufferOverflow(`G1 X1 ; ${'c'.repeat(250)}`, 'grblhal');
    if (grbl === null || grblhal === null) throw new Error('expected both lines to overflow');
    expect(lineBufferOverflowMessage(grbl)).toBe(
      'G-code line 2 has 80 significant characters — stock GRBL accepts at most 79 per line ' +
        '(spaces and comments do not count) before error:11.',
    );
    expect(lineBufferOverflowMessage(grblhal)).toBe(
      'G-code line 1 has 258 characters — grblHAL accepts at most 256 per line before error:11.',
    );
  });
});
