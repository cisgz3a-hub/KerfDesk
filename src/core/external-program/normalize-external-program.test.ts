import { describe, expect, it } from 'vitest';
import { normalizeExternalProgram, stripComments } from './normalize-external-program';

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
  it('removes comments, % markers, blank lines and surrounding spaces only', () => {
    const text =
      '%\r\n(Fusion post)\r\nG21 G90 ; metric\r\n\r\n  G0 X10 (rapid) Y5  \r\nM5\r\n%\r\n';
    expect(sent(text)).toBe('G21 G90\nG0 X10  Y5\nM5\n');
  });

  it('keeps words, order and inner spacing exactly as written', () => {
    expect(sent('g1x1.5y-2f600\nG2 X10 Y0 I5 J0\n')).toBe('g1x1.5y-2f600\nG2 X10 Y0 I5 J0\n');
  });

  it('reports what it sends and what it dropped', () => {
    const result = normalizeExternalProgram('(header)\nG0 X1\n\n%\nG1 X2 F100 ; cut\n');
    if (result.kind !== 'ok') throw new Error('refused');
    expect(result.program).toMatchObject({
      lineCount: 2,
      byteCount: 'G0 X1\nG1 X2 F100\n'.length,
      droppedLineCount: 3,
      commentsRemoved: true,
    });
  });

  it('treats an unclosed parenthesis as a comment to the end of the line', () => {
    expect(stripComments('G0 X1 (note')).toBe('G0 X1 ');
    expect(stripComments('G0 (a) X1 (b) Y2')).toBe('G0  X1  Y2');
  });

  it('drops realtime characters that sit inside comments', () => {
    expect(sent('G0 X1 (hold here!)\nM5 ; done?\n')).toBe('G0 X1\nM5\n');
  });

  it('refuses $ controller commands, naming the line', () => {
    const found = reasons('G21\n$H\nG0 X1\n');
    expect(found[0]).toContain('Line 2 is a $ controller command ($H)');
  });

  it('keeps supported advisory coordinate findings and ignores commented writes', () => {
    expect(sent('G21\nG53 G0 X1\nG55\nG92 X0\nG28\n')).toContain('G92 X0');
    expect(sent('G0 X1 (G10 L20 P1 X0)\n')).toBe('G0 X1\n');
    expect(sent('G0 X10 Y20\n')).toBe('G0 X10 Y20\n');
    expect(sent('G10L20P1X0Y0\nG1X20F600\n')).toBe('G10L20P1X0Y0\nG1X20F600\n');
  });

  it('refuses realtime command characters outside comments', () => {
    expect(reasons('G0 X1 !\n')[0]).toContain('Line 1 holds "!"');
    expect(reasons('G0 X1\n?\n')[0]).toContain('Line 2 holds "?"');
  });

  it('refuses control and non-ASCII characters', () => {
    expect(reasons('G0 X1\u0018\n')[0]).toContain('code 24');
    expect(reasons('G0 X1 Y°2\n')[0]).toContain('non-ASCII');
    expect(sent('G0\tX1\n')).toBe('G0\tX1\n');
  });

  it.each(['\u00a0', '\u000b', '\u000c', '\ufeff'])(
    'validates boundary whitespace instead of silently trimming it: %j',
    (character) => {
      expect(reasons(`${character}G0 X1\n`)[0]).toContain('control or non-ASCII');
      expect(reasons(`G0 X1${character}\n`)[0]).toContain('control or non-ASCII');
      expect(reasons(`${character}\nG0 X1\n`)[0]).toContain('Line 1');
    },
  );

  it('counts blank source lines and trims only surrounding ASCII spaces and tabs', () => {
    const result = normalizeExternalProgram('\n \t\n\t G1 X1  Y2\t \n');
    expect(result).toMatchObject({
      kind: 'ok',
      program: { droppedLineCount: 2, commentsRemoved: false, gcode: 'G1 X1  Y2\n' },
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
