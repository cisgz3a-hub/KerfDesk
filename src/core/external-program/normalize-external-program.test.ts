import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_PROGRAM_BASELINE,
  canonicalLine,
  createExternalProgramNormalizer,
  externalProgramBaseline,
  normalizeExternalProgram,
  sourceLines,
  stripComments,
} from './normalize-external-program';

const BASE = `${EXTERNAL_PROGRAM_BASELINE}\n`;

function sent(text: string): string {
  const result = normalizeExternalProgram(text);
  if (result.kind !== 'ok') throw new Error(result.reasons.join('\n'));
  return result.program.gcode;
}

function reasons(text: string): ReadonlyArray<string> {
  const result = normalizeExternalProgram(text);
  if (result.kind !== 'refused') throw new Error(`accepted: ${result.program.gcode}`);
  return result.reasons;
}

describe('external G-code program normalization (ADR-630)', () => {
  it('sends the G21 G90 baseline first, then each line as GRBL reads it', () => {
    const text =
      '%\r\n(Fusion post)\r\nG21 G90 ; metric\r\n\r\n  G0 X10 (rapid) Y5  \r\nM5\r\n%\r\n';
    expect(sent(text)).toBe(`${BASE}G21G90\nG0X10Y5\nM5\n`);
  });

  it('keeps words, their order and their case; only spaces, tabs and / go', () => {
    expect(sent('g1x1.5y-2f600\nG2 X10 Y0 I5 J0\n')).toBe(`${BASE}g1x1.5y-2f600\nG2X10Y0I5J0\n`);
  });

  it('joins split numbers as stock GRBL does, so the review sees what runs', () => {
    // GRBL discards whitespace while collecting a line: this runs as G1X100F600.
    expect(sent('G 1 X1 0 0 F600\n')).toBe(`${BASE}G1X100F600\n`);
    // A comment removed from inside a number joins it the same way.
    expect(sent('G1 X1(note)00\n')).toBe(`${BASE}G1X100\n`);
  });

  it('reports what it sends and what it dropped', () => {
    const result = normalizeExternalProgram('(header)\nG0 X1\n\n%\nG1 X2 F100 ; cut\n');
    if (result.kind !== 'ok') throw new Error('refused');
    expect(result.program).toMatchObject({
      lineCount: 3,
      byteCount: `${BASE}G0X1\nG1X2F100\n`.length,
      droppedLineCount: 3,
      commentsRemoved: true,
    });
  });

  it('treats an unclosed parenthesis as a comment to the end of the line', () => {
    expect(stripComments('G0 X1 (note')).toBe('G0 X1 ');
    expect(stripComments('G0 (a) X1 (b) Y2')).toBe('G0  X1  Y2');
  });

  it('drops realtime characters that sit inside comments', () => {
    expect(sent('G0 X1 (hold here!)\nM5 ; done?\n')).toBe(`${BASE}G0X1\nM5\n`);
  });

  it('refuses $ controller commands, naming the line', () => {
    const found = reasons('G21\n$H\nG0 X1\n');
    expect(found[0]).toContain('Line 2 is a $ controller command ($H)');
  });

  it('refuses a $ command hidden behind the / block-delete mark or spaces', () => {
    // Stock GRBL ignores '/' and spaces, so these reach it as $J= and $H.
    expect(reasons('/$J=G91 G21 X100 F600\n')[0]).toContain('Line 1 is a $ controller command');
    expect(reasons('G0 X0\n / $H\n')[0]).toContain('Line 2 is a $ controller command ($H)');
    expect(sent('/G1 X10 F100\n')).toBe(`${BASE}G1X10F100\n`);
  });

  it('sets every mode the review assumes, in a form each controller accepts', () => {
    // GRBL keeps plane, units, distance, feed and motion modes between
    // programs, so G19 or a modal G2 left by the Console would bend the path.
    expect(EXTERNAL_PROGRAM_BASELINE).toBe('G17G21G90G94G0');
    for (const kind of ['grbl-v1.1', 'grblhal', 'fluidnc'] as const) {
      expect(externalProgramBaseline(kind)).toBe(EXTERNAL_PROGRAM_BASELINE);
    }
    // Marlin stops a job at G94 (and G17 without CNC_WORKSPACE_PLANES).
    expect(externalProgramBaseline('marlin')).toBe('G21G90');
    expect(externalProgramBaseline('smoothieware')).toBe('G17G21G90G0');
    expect(normalizeExternalProgram('X1\n', 'G21G90')).toMatchObject({
      kind: 'ok',
      program: { gcode: 'G21G90\nX1\n', baseline: 'G21G90' },
    });
  });

  it('removes realtime bytes inside a comment with the comment, so they never reach the controller', () => {
    expect(sent('G1 X10 F100 ; hold!\n(feed ~ ?)\nM5\n')).toBe(`${BASE}G1X10F100\nM5\n`);
    // Outside a comment they are refused.
    expect(reasons('G1 X10 F100 !\n')[0]).toContain('realtime command');
  });

  it('refuses a checksum-framed line, which normalizing would break', () => {
    expect(reasons('N1 G1 X10 F100*42\n')[0]).toContain(
      'Line 1 (N1G1X10F100*42) carries a checksum',
    );
  });

  it("refuses FluidNC's bracket commands, which run as $ commands", () => {
    // FluidNC rebuilds [J] and [Jog] as $J= (fluidnc-line-limit.ts).
    expect(reasons('G0 X0\n[J]G91X100F600\nG1 X1 F100\n')[0]).toContain(
      'Line 2 is a bracket controller command',
    );
    expect(reasons(' [Jog] G91 X100 F600\n')[0]).toContain(
      'Line 1 is a bracket controller command',
    );
  });

  it('refuses a block the controller rejects whole, which the Frame would trace as run', () => {
    // GRBL rejects G90G91 with error:21 and stays absolute; the Inspector
    // would read the move as relative.
    expect(reasons('G0 X100\nG90G91G1X10F600\n')[0]).toContain(
      'Line 2 (G90G91G1X10F600) is one the controller rejects whole: G90 and G91 are in one modal group (error:21)',
    );
    expect(reasons('G0 X1 G1 X2 F100\n')[0]).toContain('G0 and G1 are in one modal group');
    expect(reasons('M3 S100 M5\n')[0]).toContain('M3 and M5 are in one modal group');
    expect(reasons('G1 X10 X20 F100\n')[0]).toContain('it repeats the X word (error:25)');
    expect(reasons('G92 G1 X0 F100\n')[0]).toContain(
      'G92 and G1 both take the axis words (error:24)',
    );
  });

  it('accepts the usual CAM preamble and setup lines', () => {
    const program = [
      'G17 G21 G90 G94 G40 G49 G80',
      'G90 G94 G91.1 G40 G49 G17',
      'G28 G91 Z0',
      'G53 G0 Z0',
      'G0 G90 G54 X0 Y0',
      'M3 S1000 M8',
      'G4 P1',
      'G1 X10 Y10 F1000 S500',
      'M5 M9',
      'M30',
    ].join('\n');
    expect(normalizeExternalProgram(program).kind).toBe('ok');
  });

  it('keeps coordinate commands for the review to warn about, and ignores commented ones', () => {
    expect(sent('G21\nG53 G0 X1\nG55\nG92 X0\nG28\n')).toContain('G92X0');
    expect(sent('G0 X1 (G10 L20 P1 X0)\n')).toBe(`${BASE}G0X1\n`);
    expect(sent('G10L20P1X0Y0\nG1X20F600\n')).toBe(`${BASE}G10L20P1X0Y0\nG1X20F600\n`);
  });

  it('refuses realtime command characters outside comments', () => {
    expect(reasons('G0 X1 !\n')[0]).toContain('Line 1 holds "!"');
    expect(reasons('G0 X1\n?\n')[0]).toContain('Line 2 holds "?"');
  });

  it('refuses control and non-ASCII characters, but not tabs', () => {
    expect(reasons('G0 X1\u0018\n')[0]).toContain('code 24');
    expect(reasons('G0 X1 Y°2\n')[0]).toContain('non-ASCII');
    expect(sent('G0\tX1\n')).toBe(`${BASE}G0X1\n`);
  });

  // Stock GRBL throws away every byte at or below a space while it collects a
  // line (protocol.c), so a DOS end-of-file mark or a form feed changes nothing
  // it runs. Bytes a GRBL-family controller acts on stay refused: Ctrl-X resets
  // every one of them; grblHAL also takes Ctrl-C, Ctrl-T after ESC and Ctrl-Y
  // as commands, and backspace or DEL as a line edit (grbl.h, protocol.c).
  it.each(['\u001a', '\u000b', '\u000c', '\u0001', '\u001f'])(
    'drops a control character GRBL discards: %j',
    (character) => {
      expect(sent(`G0 X1${character}\n${character}\n`)).toBe(`${BASE}G0X1\n`);
      expect(sent(`${character}G0 X1\n`)).toBe(`${BASE}G0X1\n`);
    },
  );

  it('drops a trailing DOS end-of-file mark', () => {
    expect(normalizeExternalProgram('G21\r\nG0 X1\r\n\u001a')).toMatchObject({
      kind: 'ok',
      program: { gcode: `${BASE}G21\nG0X1\n`, droppedLineCount: 1 },
    });
  });

  it.each([
    ['\u0003', 3],
    ['\u0008', 8],
    ['\u0014', 20],
    ['\u0018', 24],
    ['\u0019', 25],
    ['\u001b', 27],
    ['\u007f', 127],
  ])('refuses a control character a controller acts on: %j', (character, code) => {
    expect(reasons(`G0 X1${character}\n`)[0]).toContain(`code ${code}`);
  });

  it.each([' ', '﻿'])('refuses non-ASCII whitespace instead of dropping it: %j', (character) => {
    expect(reasons(`${character}G0 X1\n`)[0]).toContain('control or non-ASCII');
    expect(reasons(`G0 X1${character}\n`)[0]).toContain('control or non-ASCII');
    expect(reasons(`${character}\nG0 X1\n`)[0]).toContain('Line 1');
  });

  it('counts blank source lines', () => {
    const result = normalizeExternalProgram('\n \t\n\t G1 X1  Y2\t \n');
    expect(result).toMatchObject({
      kind: 'ok',
      program: { droppedLineCount: 2, commentsRemoved: false, gcode: `${BASE}G1X1Y2\n` },
    });
  });

  it('refuses binary files and files with nothing to send', () => {
    expect(reasons('G0\0X1')[0]).toContain('NUL byte');
    expect(reasons('(only a comment)\n%\n\n')[0]).toContain('no G-code line');
  });

  it('lists five problems and counts the rest', () => {
    const found = reasons(Array.from({ length: 8 }, (_, index) => `$${index}`).join('\n'));
    expect(found).toHaveLength(6);
    expect(found[5]).toBe('…and 3 more lines like these.');
  });
});

describe('chunked normalization (ADR-630)', () => {
  it('splits CR, LF and CRLF lines without a trailing blank line', () => {
    expect([...sourceLines('a\r\nb\rc\nd')]).toEqual(['a', 'b', 'c', 'd']);
    expect([...sourceLines('a\n')]).toEqual(['a']);
    expect([...sourceLines('\n\n')]).toEqual(['', '']);
    expect([...sourceLines('')]).toEqual([]);
  });

  it('gives the same result fed line by line as all at once', () => {
    const text = '(head)\nG21\n G0 X1 Y2\n%\nM5\n';
    const normalizer = createExternalProgramNormalizer();
    for (const line of sourceLines(text)) normalizer.push(line);
    expect(normalizer.finish()).toEqual(normalizeExternalProgram(text));
  });

  it('canonicalizes a line the way stock GRBL collects it', () => {
    expect(canonicalLine(' G1 X1\t0 / Y2 ')).toBe('G1X10Y2');
  });
});
