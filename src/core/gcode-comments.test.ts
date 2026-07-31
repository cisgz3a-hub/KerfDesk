import { describe, expect, it } from 'vitest';
import { sanitizeGcodeCommentValue } from './gcode-comments';

describe('sanitizeGcodeCommentValue', () => {
  it('flattens line breaks and control characters without collapsing field spacing', () => {
    expect(sanitizeGcodeCommentValue('safe\r\nM3\u0085S999\u2028G0')).toBe('safe  M3 S999 G0');
  });

  it('truncates at a UTF-8 code-point boundary and keeps room for the suffix', () => {
    const sanitized = sanitizeGcodeCommentValue('🙂'.repeat(30), 48);

    expect(new TextEncoder().encode(sanitized).byteLength).toBeLessThanOrEqual(48);
    expect(sanitized.endsWith('...')).toBe(true);
    expect(sanitized).not.toContain('�');
  });
});
