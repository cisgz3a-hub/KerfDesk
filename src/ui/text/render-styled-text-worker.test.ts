// Perf audit N4-P3-2 (ADR-643 Amendment 1): remote control and registration
// jig edits lay their text out in the text worker, not on the UI thread.

import { describe, expect, it, vi } from 'vitest';
import type { TextRenderResult } from '../../core/text';
import { renderStyledText } from './render-styled-text';

const RESULT: TextRenderResult = {
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
  paths: [],
};

const calls = vi.hoisted(() => ({ offThread: 0, inThread: 0, signals: [] as unknown[] }));

vi.mock('./text-worker-session', () => ({
  renderTextGeometryOffThread: vi.fn(async (_input: unknown, signal?: AbortSignal) => {
    calls.offThread += 1;
    calls.signals.push(signal);
    return RESULT;
  }),
}));

vi.mock('./render-text-geometry', () => ({
  renderTextGeometry: vi.fn(async () => {
    calls.inThread += 1;
    return RESULT;
  }),
}));

vi.mock('./text-weld-worker-client', () => ({
  applyTextWeldInWorker: vi.fn(async (render: TextRenderResult) => render),
}));

describe('remote and jig text edits (perf audit N4-P3-2)', () => {
  it('lay the text out in the text worker with the caller’s signal', async () => {
    const controller = new AbortController();
    const rendered = await renderStyledText(
      {
        fontKey: 'roboto-regular',
        sizeMm: 5,
        alignment: 'left',
        lineHeight: 1.4,
        letterSpacing: 0,
        color: '#000000',
        textBox: {
          mode: 'fixed',
          widthMm: 150,
          heightMm: 30,
          wrap: true,
          fit: 'shrink',
          minSizeMm: 2,
        },
      },
      'A long paragraph',
      undefined,
      controller.signal,
    );
    expect(rendered.bounds).toEqual(RESULT.bounds);
    expect(calls.offThread).toBe(1);
    expect(calls.inThread).toBe(0);
    expect(calls.signals[0]).toBe(controller.signal);
  });
});
