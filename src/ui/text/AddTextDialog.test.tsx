import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreText from '../../core/text';

const textMocks = vi.hoisted(() => ({
  loadFont: vi.fn(async () => new ArrayBuffer(8)),
  textToPolylines: vi.fn(async (input: { readonly color: string }) => ({
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    paths: [
      {
        color: input.color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
          },
        ],
      },
    ],
  })),
}));

vi.mock('./font-loader', () => ({
  cssFamilyForFont: (key: string) => `lf2-${key}`,
  ensureFontCss: vi.fn(async () => undefined),
  loadFont: textMocks.loadFont,
}));

vi.mock('../../core/text', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreText>();
  return {
    ...actual,
    textToPolylines: textMocks.textToPolylines,
  };
});

import { DEFAULT_FONT_KEY } from '../../core/text';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { AddTextDialog } from './AddTextDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  textMocks.loadFont.mockClear();
  textMocks.textToPolylines.mockClear();
  useStore.getState().newProject();
  useUiStore.setState({ textDialog: null });
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
});

afterEach(() => {
  useStore.getState().newProject();
  useUiStore.setState({ textDialog: null });
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
});

describe('AddTextDialog unknown font safety', () => {
  it('inserts a diacritic into the content box when the accent button is clicked', async () => {
    useUiStore.setState({ textDialog: { mode: 'add' } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<AddTextDialog />);
      });

      const insert = host.querySelector('button[title="Insert é"]');
      if (!(insert instanceof HTMLButtonElement)) throw new Error('Insert é button not rendered');
      await act(async () => {
        insert.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });

      const textarea = host.querySelector('textarea');
      if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Text area not rendered');
      expect(textarea.value).toBe('é');

      const form = host.querySelector('form');
      if (!(form instanceof HTMLFormElement)) throw new Error('Text form not rendered');
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      const saved = useStore.getState().project.scene.objects.find((obj) => obj.kind === 'text');
      expect(saved?.kind).toBe('text');
      if (saved?.kind !== 'text') return;
      expect(saved.content).toBe('é');
      const renderInput = textMocks.textToPolylines.mock.calls[0]?.[0] as
        | { readonly content?: string }
        | undefined;
      expect(renderInput?.content).toBe('é');
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('stores and renders Unicode text in normalized NFC form', async () => {
    useUiStore.setState({
      textDialog: {
        mode: 'edit',
        id: 'text-1',
        content: 'Cafe\u0301',
        fontKey: 'dancing-script-regular',
        sizeMm: 12,
        alignment: 'left',
        lineHeight: 1.2,
        letterSpacing: 0,
        color: '#000000',
      },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<AddTextDialog />);
      });

      const form = host.querySelector('form');
      if (!(form instanceof HTMLFormElement)) throw new Error('Text form not rendered');
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      const saved = useStore
        .getState()
        .project.scene.objects.find((obj) => obj.kind === 'text' && obj.id === 'text-1');
      expect(saved?.kind).toBe('text');
      if (saved?.kind !== 'text') return;
      expect(saved.content).toBe('Caf\u00e9');
      const renderInput = textMocks.textToPolylines.mock.calls[0]?.[0] as
        | { readonly content?: string }
        | undefined;
      expect(renderInput?.content).toBe('Caf\u00e9');
      expect(saved.fontKey).toBe('dancing-script-regular');
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('normalizes an unknown edit font key when regenerating fallback geometry', async () => {
    useUiStore.setState({
      textDialog: {
        mode: 'edit',
        id: 'text-1',
        content: 'Hello',
        fontKey: 'future-font',
        sizeMm: 12,
        alignment: 'left',
        lineHeight: 1.2,
        letterSpacing: 0,
        color: '#000000',
      },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<AddTextDialog />);
      });

      expect(host.textContent).toContain('Missing font: future-font');
      const form = host.querySelector('form');
      if (!(form instanceof HTMLFormElement)) throw new Error('Text form not rendered');
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      const saved = useStore
        .getState()
        .project.scene.objects.find((obj) => obj.kind === 'text' && obj.id === 'text-1');
      expect(saved?.kind).toBe('text');
      if (saved?.kind !== 'text') return;
      expect(saved.fontKey).toBe(DEFAULT_FONT_KEY);
      expect(textMocks.loadFont).toHaveBeenCalledWith(DEFAULT_FONT_KEY);
      expect(useToastStore.getState().toasts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('future-font'),
            variant: 'warning',
          }),
        ]),
      );
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});
