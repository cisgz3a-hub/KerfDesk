import { describe, expect, it } from 'vitest';
import type { TextBoxSettings } from '../scene/text-box';
import { layoutTextBox } from './text-box-layout';
const box: TextBoxSettings = {
  mode: 'fixed',
  widthMm: 3,
  heightMm: 1,
  wrap: true,
  fit: 'none',
  minSizeMm: 0.4,
};
const measure = (text: string, size: number): number => Array.from(text).length * size;
const layout = (content: string, settings: Partial<TextBoxSettings> = {}) =>
  layoutTextBox(
    { content, sizeMm: 1, lineHeight: 2, textBox: { ...box, ...settings } },
    measure,
    1,
  );
describe('text box layout', () => {
  it('wraps at words and grows auto-height without altering source content', () => {
    expect(layout('AB CD', { mode: 'auto-height' })).toMatchObject({
      content: 'AB\nCD',
      lineCount: 2,
      widthMm: 3,
      heightMm: 3,
      sizeMm: 1,
      overflow: false,
    });
    expect(layout('A\n\nB', { mode: 'auto-height' })).toMatchObject({
      content: 'A\n\nB',
      lineCount: 3,
      heightMm: 5,
    });
  });
  it('uses natural width without wrapping or enlargement', () => {
    expect(layout('ABCDE', { mode: 'auto-width', fit: 'shrink' })).toMatchObject({
      content: 'ABCDE',
      widthMm: 5,
      sizeMm: 1,
      overflow: false,
    });
  });
  it('finds a smaller uniform font that fits, respecting the minimum', () => {
    const fitted = layout('AB CD', { fit: 'shrink' });
    expect(fitted.sizeMm).toBeCloseTo(0.6, 4);
    expect(fitted.overflow).toBe(false);
    const limited = layout('AB CD', { fit: 'shrink', minSizeMm: 0.8 });
    expect(limited.sizeMm).toBe(0.8);
    expect(limited.overflow).toBe(true);
    expect(limited.content.replaceAll('\n', '')).toContain('AB');
  });
  it('breaks long supplementary-character runs without splitting surrogate pairs', () => {
    expect(layout('😀😀😀', { mode: 'auto-height', widthMm: 2 }).content).toBe('😀😀\n😀');
  });
  it('reports an oversized glyph instead of hiding it', () => {
    expect(layout('A', { widthMm: 0.5 }).overflow).toBe(true);
  });
});
