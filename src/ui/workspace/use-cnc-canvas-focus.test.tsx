import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CNC_CANVAS_FOCUS_QUERY,
  CNC_PANE_VISIBILITY_STORAGE_KEY,
  useCncCanvasFocus,
} from './use-cnc-canvas-focus';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => localStorage.clear());

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('useCncCanvasFocus', () => {
  it('starts with the 3D pane collapsed at laptop widths', async () => {
    const media = fakeMediaQuery(true);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media.query),
    );
    const view = await renderProbe();
    try {
      expect(window.matchMedia).toHaveBeenCalledWith(CNC_CANVAS_FOCUS_QUERY);
      expect(view.button.getAttribute('aria-pressed')).toBe('true');
    } finally {
      await view.unmount();
    }
  });

  it('starts expanded on a wide display', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => fakeMediaQuery(false).query),
    );
    const view = await renderProbe();
    try {
      expect(view.button.getAttribute('aria-pressed')).toBe('false');
    } finally {
      await view.unmount();
    }
  });

  it('persists an explicit restore and does not override it at the breakpoint', async () => {
    const media = fakeMediaQuery(true);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media.query),
    );
    const first = await renderProbe();
    await act(async () => first.button.click());
    expect(first.button.getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(CNC_PANE_VISIBILITY_STORAGE_KEY)).toBe('expanded');

    act(() => media.emit(false));
    act(() => media.emit(true));
    expect(first.button.getAttribute('aria-pressed')).toBe('false');
    await first.unmount();

    const restored = await renderProbe();
    try {
      expect(restored.button.getAttribute('aria-pressed')).toBe('false');
    } finally {
      await restored.unmount();
    }
  });
});

function Probe(): JSX.Element {
  const focus = useCncCanvasFocus();
  return (
    <button type="button" aria-pressed={focus.collapsed} onClick={focus.toggleCollapsed}>
      Toggle
    </button>
  );
}

async function renderProbe(): Promise<{
  readonly button: HTMLButtonElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<Probe />);
  });
  const button = host.querySelector('button');
  if (button === null) throw new Error('probe button missing');
  return {
    button,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function fakeMediaQuery(initial: boolean): {
  readonly query: MediaQueryList;
  readonly emit: (matches: boolean) => void;
} {
  let listener: ((event: MediaQueryListEvent) => void) | null = null;
  const query = {
    matches: initial,
    media: CNC_CANVAS_FOCUS_QUERY,
    onchange: null,
    addEventListener: (_type: string, next: (event: MediaQueryListEvent) => void) => {
      listener = next;
    },
    removeEventListener: () => {
      listener = null;
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  } as MediaQueryList;
  return {
    query,
    emit: (matches) => listener?.({ matches } as MediaQueryListEvent),
  };
}
