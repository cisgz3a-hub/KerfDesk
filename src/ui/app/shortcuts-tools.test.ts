import { describe, expect, it, vi } from 'vitest';
import { handleToolShortcut } from './shortcuts';

function fakeKeydown(opts: {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly target?: HTMLElement | null;
}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (opts.target !== undefined) {
    Object.defineProperty(e, 'target', { value: opts.target, configurable: true });
  }
  return e;
}

describe('handleToolShortcut - Measure tool', () => {
  it('Alt+M arms the Measure tool', () => {
    const setToolMode = vi.fn();
    const handled = handleToolShortcut(fakeKeydown({ key: 'm', altKey: true }), { setToolMode });

    expect(handled).toBe(true);
    expect(setToolMode).toHaveBeenCalledWith({ kind: 'measure' });
  });

  it('Alt+M inside an input does not arm a tool', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const setToolMode = vi.fn();

    const handled = handleToolShortcut(fakeKeydown({ key: 'm', altKey: true, target: input }), {
      setToolMode,
    });

    expect(handled).toBe(false);
    expect(setToolMode).not.toHaveBeenCalled();
    input.remove();
  });
});

describe('handleToolShortcut - LightBurn tool arming', () => {
  it('Ctrl+E arms the Ellipse tool', () => {
    const setToolMode = vi.fn();
    const handled = handleToolShortcut(fakeKeydown({ key: 'e', ctrlKey: true }), { setToolMode });

    expect(handled).toBe(true);
    expect(setToolMode).toHaveBeenCalledWith({ kind: 'draw', shape: 'ellipse' });
  });

  it('Ctrl+R arms the Rectangle tool', () => {
    const setToolMode = vi.fn();

    handleToolShortcut(fakeKeydown({ key: 'r', ctrlKey: true }), { setToolMode });

    expect(setToolMode).toHaveBeenCalledWith({ kind: 'draw', shape: 'rect' });
  });

  it('Ctrl+L arms the pen tool', () => {
    const setToolMode = vi.fn();

    handleToolShortcut(fakeKeydown({ key: 'l', ctrlKey: true }), { setToolMode });

    expect(setToolMode).toHaveBeenCalledWith({ kind: 'draw', shape: 'polyline' });
  });

  it('Ctrl+Shift+E does not arm a tool because it exports G-code', () => {
    const setToolMode = vi.fn();
    const handled = handleToolShortcut(fakeKeydown({ key: 'e', ctrlKey: true, shiftKey: true }), {
      setToolMode,
    });

    expect(handled).toBe(false);
    expect(setToolMode).not.toHaveBeenCalled();
  });

  it('a bare key without Ctrl or Cmd does not arm a tool', () => {
    const setToolMode = vi.fn();
    const handled = handleToolShortcut(fakeKeydown({ key: 'e' }), { setToolMode });

    expect(handled).toBe(false);
    expect(setToolMode).not.toHaveBeenCalled();
  });

  it('Ctrl+E inside an input does not arm a tool', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const setToolMode = vi.fn();

    handleToolShortcut(fakeKeydown({ key: 'e', ctrlKey: true, target: input }), { setToolMode });

    expect(setToolMode).not.toHaveBeenCalled();
    input.remove();
  });

  it('Ctrl+K is not handled', () => {
    const setToolMode = vi.fn();
    const handled = handleToolShortcut(fakeKeydown({ key: 'k', ctrlKey: true }), { setToolMode });

    expect(handled).toBe(false);
  });
});
