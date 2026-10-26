import { describe, expect, it } from 'vitest';
import { gcodeCommentLabel, sanitizeGcodeCommentValue } from './gcode-comments';

describe('sanitizeGcodeCommentValue', () => {
  it('flattens line breaks and control characters without collapsing field spacing', () => {
    expect(sanitizeGcodeCommentValue('safe\r\nM3\u0085S999\u2028G0')).toBe('safe  M3 S999 G0');
  });

  it('truncates long values and keeps room for the suffix', () => {
    const sanitized = sanitizeGcodeCommentValue('é'.repeat(60), 48);

    expect(sanitized).toBe(`${'e'.repeat(45)}...`);
  });

  // GRBL runs any byte above 0x7F as a realtime command, even inside a
  // comment line, so no written comment may carry one.
  it.each([
    ['Default 400×400', 'Default 400x400'],
    ['60° V-bit — 1/4" shank', '60deg V-bit - 1/4" shank'],
    ['Äpfel Öl café', 'Apfel Ol cafe'],
    ['bit 🙂 深', 'bit _ _'],
  ])('folds %s to printable ASCII', (input, expected) => {
    const sanitized = sanitizeGcodeCommentValue(input);

    expect(sanitized).toBe(expected);
    expect([...new TextEncoder().encode(sanitized)].every((byte) => byte < 0x80)).toBe(true);
  });

  it.each(['Cut! Resume~ Status?', 'Fullwidth！～？', 'Small﹗﹖', 'Unknown 🙂 深'])(
    'removes realtime bytes after folding %s',
    (input) => {
      const sanitized = sanitizeGcodeCommentValue(input);
      expect(sanitized).not.toMatch(/[!~?]/);
      expect(sanitized).toMatch(/^[\x20-\x7e]*$/);
    },
  );

  it('preserves ordinary ASCII labels and applies the cap after safe replacement', () => {
    expect(sanitizeGcodeCommentValue('1/4 in. bit (roughing) - A+B')).toBe(
      '1/4 in. bit (roughing) - A+B',
    );
    expect(sanitizeGcodeCommentValue('!~?！～？🙂'.repeat(20), 12)).toBe('_________...');
    expect(sanitizeGcodeCommentValue('!~?！～？🙂', 0)).toBe('');
  });
});

describe('gcodeCommentLabel', () => {
  it('keeps ordinary layer ids and colours byte for byte', () => {
    for (const label of ['L1', 'cut-red', '#ff0000', 'material-test-row-3', 'color:#808080']) {
      expect(gcodeCommentLabel(label)).toBe(label);
    }
  });

  it('turns a line-break payload into inert text on the same line', () => {
    expect(gcodeCommentLabel('cut\nG1 X300 Y10 F100 S1000\r;')).toBe(
      'cut G1 X300 Y10 F100 S1000 ;',
    );
  });

  it('names a label that sanitises to nothing', () => {
    expect(gcodeCommentLabel('\r\n')).toBe('(blank)');
  });
});
