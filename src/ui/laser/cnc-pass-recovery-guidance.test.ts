import { describe, expect, it } from 'vitest';
import { cncExtractionGuidance } from './cnc-pass-recovery-guidance';

describe('cncExtractionGuidance', () => {
  it('warns that a latched spindle may still be spinning after a transport loss', () => {
    const guidance = cncExtractionGuidance('disconnect');
    expect(guidance.spindleNote).toContain('STILL BE SPINNING');
    expect(guidance.steps.some((step) => step.includes('jog Z up now'))).toBe(true);
    expect(guidance.steps.some((step) => step.includes('Do not power the spindle'))).toBe(true);
  });

  it('drops the spinning-extraction step after a controller reboot and requires re-zeroing', () => {
    const guidance = cncExtractionGuidance('controller-reboot');
    expect(guidance.spindleNote).toContain('re-established');
    expect(guidance.steps.some((step) => step.includes('jog Z up now'))).toBe(false);
    expect(guidance.steps.some((step) => step.includes('Do not power the spindle'))).toBe(true);
  });

  it('covers every interruption kind', () => {
    const kinds = [
      'disconnect',
      'controller-error',
      'write-failed',
      'controller-reboot',
      'stream-stalled',
      'cancelled',
      'unknown',
    ] as const;
    for (const kind of kinds) {
      const guidance = cncExtractionGuidance(kind);
      expect(guidance.title.length).toBeGreaterThan(0);
      expect(guidance.steps.length).toBeGreaterThan(0);
    }
  });
});
