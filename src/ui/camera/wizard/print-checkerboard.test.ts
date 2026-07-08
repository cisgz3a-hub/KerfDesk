import { afterEach, describe, expect, it, vi } from 'vitest';
import { printCheckerboard } from './print-checkerboard';

afterEach(() => {
  document.querySelectorAll('iframe').forEach((f) => f.remove());
  vi.restoreAllMocks();
});

describe('printCheckerboard', () => {
  it('writes the SVG into a hidden iframe and triggers print', () => {
    // jsdom iframes expose contentWindow but not print(); provide it.
    const print = vi.fn();
    const focus = vi.fn();
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (
      this: HTMLIFrameElement,
    ) {
      // Back the fake window with the real srcdoc document so write() works.
      const doc = document.implementation.createHTMLDocument('print');
      return {
        document: doc,
        print,
        focus,
        onafterprint: null,
      } as unknown as Window;
    });

    const result = printCheckerboard('<svg id="board"></svg>');
    expect(result).toBe('printed');
    expect(print).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable and cleans up when the iframe cannot print', () => {
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(null);
    const before = document.querySelectorAll('iframe').length;
    expect(printCheckerboard('<svg></svg>')).toBe('unavailable');
    expect(document.querySelectorAll('iframe').length).toBe(before);
  });
});
