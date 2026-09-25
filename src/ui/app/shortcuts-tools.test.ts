import { describe, expect, it, vi } from 'vitest';
import { handleToolShortcut, type ToolCtx } from './shortcuts';

function fakeKeydown(opts: {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly target?: HTMLElement | null;
}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    key: opts.key,
    code: opts.code ?? '',
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

function makeCtx(): ToolCtx & {
  readonly setToolMode: ReturnType<typeof vi.fn<ToolCtx['setToolMode']>>;
  readonly openConvertToBitmap: ReturnType<
    typeof vi.fn<NonNullable<ToolCtx['openConvertToBitmap']>>
  >;
  readonly openTraceImage: ReturnType<typeof vi.fn<ToolCtx['openTraceImage']>>;
} {
  return { setToolMode: vi.fn(), openConvertToBitmap: vi.fn(), openTraceImage: vi.fn() };
}

describe('handleToolShortcut - Measure tool', () => {
  it('Alt+M arms the Measure tool', () => {
    const ctx = makeCtx();
    const handled = handleToolShortcut(fakeKeydown({ key: 'm', altKey: true }), ctx);

    expect(handled).toBe(true);
    expect(ctx.setToolMode).toHaveBeenCalledWith({ kind: 'measure' });
  });

  it('Alt+M inside an input does not arm a tool', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ctx = makeCtx();

    const handled = handleToolShortcut(fakeKeydown({ key: 'm', altKey: true, target: input }), ctx);

    expect(handled).toBe(false);
    expect(ctx.setToolMode).not.toHaveBeenCalled();
    input.remove();
  });
});

describe('handleToolShortcut - Trace Image (Alt/Option+T, LightBurn binding)', () => {
  it('Alt+T requests Trace Image', () => {
    const ctx = makeCtx();
    const event = fakeKeydown({ key: 't', code: 'KeyT', altKey: true });

    expect(handleToolShortcut(event, ctx)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(ctx.openTraceImage).toHaveBeenCalledTimes(1);
    expect(ctx.setToolMode).not.toHaveBeenCalled();
  });

  it('Option+T on macOS, which types a dagger, still requests Trace Image', () => {
    const ctx = makeCtx();

    expect(handleToolShortcut(fakeKeydown({ key: '†', code: 'KeyT', altKey: true }), ctx)).toBe(
      true,
    );
    expect(ctx.openTraceImage).toHaveBeenCalledTimes(1);
  });

  it('Option+M on macOS, which types a micro sign, still arms Measure', () => {
    const ctx = makeCtx();

    handleToolShortcut(fakeKeydown({ key: 'µ', code: 'KeyM', altKey: true }), ctx);

    expect(ctx.setToolMode).toHaveBeenCalledWith({ kind: 'measure' });
  });

  it('follows the typed letter when the layout puts another letter on the T key', () => {
    const ctx = makeCtx();

    // Dvorak: the physical T key types Y, so Alt on it is not Alt+T.
    expect(handleToolShortcut(fakeKeydown({ key: 'y', code: 'KeyT', altKey: true }), ctx)).toBe(
      false,
    );
    expect(ctx.openTraceImage).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'AltGr (Ctrl+Alt)', ctrlKey: true },
    { name: 'Alt+Shift', shiftKey: true },
    { name: 'Cmd+Option', metaKey: true },
  ])('$name+T is left alone', (modifiers) => {
    const ctx = makeCtx();

    expect(
      handleToolShortcut(fakeKeydown({ key: 't', code: 'KeyT', altKey: true, ...modifiers }), ctx),
    ).toBe(false);
    expect(ctx.openTraceImage).not.toHaveBeenCalled();
  });

  it('Alt+T inside an input does not open Trace Image', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ctx = makeCtx();

    expect(handleToolShortcut(fakeKeydown({ key: 't', altKey: true, target: input }), ctx)).toBe(
      false,
    );
    expect(ctx.openTraceImage).not.toHaveBeenCalled();
    input.remove();
  });

  it('plain T still arms canvas text rather than Trace Image', () => {
    const ctx = makeCtx();

    handleToolShortcut(fakeKeydown({ key: 't', code: 'KeyT' }), ctx);

    expect(ctx.setToolMode).toHaveBeenCalledWith({ kind: 'text' });
    expect(ctx.openTraceImage).not.toHaveBeenCalled();
  });
});

describe('handleToolShortcut - canvas text', () => {
  it('T arms text placement while preserving the document until the canvas click', () => {
    const ctx = makeCtx();
    expect(handleToolShortcut(fakeKeydown({ key: 't' }), ctx)).toBe(true);
    expect(ctx.setToolMode).toHaveBeenCalledWith({ kind: 'text' });
  });

  it.each(['input', 'textarea', 'div'])('leaves T inside an editable %s alone', (tag) => {
    const target = document.createElement(tag);
    if (tag === 'div') target.setAttribute('contenteditable', 'true');
    const ctx = makeCtx();
    expect(handleToolShortcut(fakeKeydown({ key: 't', target }), ctx)).toBe(false);
    expect(ctx.setToolMode).not.toHaveBeenCalled();
  });

  it('does not intercept Ctrl+T for a browser tab', () => {
    const ctx = makeCtx();
    expect(handleToolShortcut(fakeKeydown({ key: 't', ctrlKey: true }), ctx)).toBe(false);
  });
});

describe('handleToolShortcut - Convert to Bitmap (Ctrl/Cmd+Shift+B)', () => {
  it('Ctrl+Shift+B requests Convert to Bitmap (LightBurn §7.4 binding)', () => {
    const ctx = makeCtx();
    const handled = handleToolShortcut(
      fakeKeydown({ key: 'b', ctrlKey: true, shiftKey: true }),
      ctx,
    );

    expect(handled).toBe(true);
    expect(ctx.openConvertToBitmap).toHaveBeenCalledTimes(1);
    expect(ctx.setToolMode).not.toHaveBeenCalled();
  });

  it('Cmd+Shift+B works on macOS metaKey', () => {
    const ctx = makeCtx();
    const handled = handleToolShortcut(
      fakeKeydown({ key: 'B', metaKey: true, shiftKey: true }),
      ctx,
    );

    expect(handled).toBe(true);
    expect(ctx.openConvertToBitmap).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+B without Shift does nothing', () => {
    const ctx = makeCtx();
    const handled = handleToolShortcut(fakeKeydown({ key: 'b', ctrlKey: true }), ctx);

    expect(handled).toBe(false);
    expect(ctx.openConvertToBitmap).not.toHaveBeenCalled();
  });

  it('Ctrl+Shift+B inside an input does not fire', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ctx = makeCtx();

    const handled = handleToolShortcut(
      fakeKeydown({ key: 'b', ctrlKey: true, shiftKey: true, target: input }),
      ctx,
    );

    expect(handled).toBe(false);
    expect(ctx.openConvertToBitmap).not.toHaveBeenCalled();
    input.remove();
  });
});

describe('handleToolShortcut - LightBurn tool arming', () => {
  it('Ctrl+E arms the Ellipse tool', () => {
    const ctx = makeCtx();
    const handled = handleToolShortcut(fakeKeydown({ key: 'e', ctrlKey: true }), ctx);

    expect(handled).toBe(true);
    expect(ctx.setToolMode).toHaveBeenCalledWith({ kind: 'draw', shape: 'ellipse' });
  });

  it('Ctrl+R arms the Rectangle tool', () => {
    const ctx = makeCtx();

    handleToolShortcut(fakeKeydown({ key: 'r', ctrlKey: true }), ctx);

    expect(ctx.setToolMode).toHaveBeenCalledWith({ kind: 'draw', shape: 'rect' });
  });

  it('Ctrl+L arms the pen tool', () => {
    const ctx = makeCtx();

    handleToolShortcut(fakeKeydown({ key: 'l', ctrlKey: true }), ctx);

    expect(ctx.setToolMode).toHaveBeenCalledWith({ kind: 'draw', shape: 'polyline' });
  });

  it('Ctrl+Shift+E does not arm a tool because it exports G-code', () => {
    const ctx = makeCtx();
    const handled = handleToolShortcut(
      fakeKeydown({ key: 'e', ctrlKey: true, shiftKey: true }),
      ctx,
    );

    expect(handled).toBe(false);
    expect(ctx.setToolMode).not.toHaveBeenCalled();
  });

  it('a bare key without Ctrl or Cmd does not arm a tool', () => {
    const ctx = makeCtx();
    const handled = handleToolShortcut(fakeKeydown({ key: 'e' }), ctx);

    expect(handled).toBe(false);
    expect(ctx.setToolMode).not.toHaveBeenCalled();
  });

  it('Ctrl+E inside an input does not arm a tool', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ctx = makeCtx();

    handleToolShortcut(fakeKeydown({ key: 'e', ctrlKey: true, target: input }), ctx);

    expect(ctx.setToolMode).not.toHaveBeenCalled();
    input.remove();
  });

  it('Ctrl+K is not handled', () => {
    const ctx = makeCtx();
    const handled = handleToolShortcut(fakeKeydown({ key: 'k', ctrlKey: true }), ctx);

    expect(handled).toBe(false);
  });
});
