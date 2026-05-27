import { describe, expect, it } from 'vitest';
import type { ParseSvgResult } from '../../io/svg';
import { describeImportError, describeImportResult } from './import-toasts';

function baseResult(over: Partial<ParseSvgResult> = {}): ParseSvgResult {
  return {
    object: {
      kind: 'imported-svg',
      id: 'O1',
      source: 'a.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        mirrorX: false,
        mirrorY: false,
        rotationDeg: 0,
      },
      paths: [{ color: '#ff0000', polylines: [] }],
    },
    stripped: { scripts: 0, foreignObjects: 0, externalLinks: 0, dataUris: 0 },
    notes: [],
    ignoredTextElements: 0,
    ignoredImageElements: 0,
    ...over,
  };
}

describe('describeImportResult', () => {
  it('returns success toast with color count', () => {
    const toasts = describeImportResult('design.svg', baseResult());
    expect(toasts[0]?.variant).toBe('success');
    expect(toasts[0]?.message).toContain('1 color');
  });

  it('returns warning when SVG has no drawable content', () => {
    const toasts = describeImportResult('empty.svg', baseResult({ object: null }));
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.variant).toBe('warning');
    expect(toasts[0]?.message).toContain('no drawable content');
  });

  it('emits an info toast when DOMPurify stripped script tags', () => {
    const toasts = describeImportResult(
      'hack.svg',
      baseResult({ stripped: { scripts: 2, foreignObjects: 0, externalLinks: 0, dataUris: 0 } }),
    );
    expect(toasts.some((t) => t.message.includes('2 script tags'))).toBe(true);
  });

  it('emits info toasts for ignored text and image elements', () => {
    const toasts = describeImportResult(
      'mixed.svg',
      baseResult({ ignoredTextElements: 4, ignoredImageElements: 1 }),
    );
    expect(toasts.some((t) => t.message.includes('4 text elements'))).toBe(true);
    expect(toasts.some((t) => t.message.includes('1 embedded image'))).toBe(true);
  });
});

describe('describeImportError', () => {
  it('formats Error.message', () => {
    const t = describeImportError('bad.svg', new Error('parse failed'));
    expect(t.variant).toBe('error');
    expect(t.message).toContain('parse failed');
  });
});
