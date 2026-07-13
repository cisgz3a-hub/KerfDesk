import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
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

import { useStore } from '../state';
import { svgObj } from '../state/test-helpers';
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
  it('links new text to the selected vector guide', async () => {
    const guide = svgObj('guide-path', ['#ff0000']);
    useStore.getState().importSvgObject({
      ...guide,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
      paths: [
        {
          color: '#ff0000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
              ],
            },
          ],
        },
      ],
    });
    useStore.getState().selectObject(guide.id);
    useUiStore.setState({ textDialog: { mode: 'add' } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<AddTextDialog />));
      await act(async () => {
        const content = requireTextarea(host);
        content.value = 'Path text';
        Simulate.change(content);
        const toggle = host.querySelector(
          'input[title="Place text along a selected vector path."]',
        );
        if (!(toggle instanceof HTMLInputElement)) throw new Error('Path toggle missing');
        toggle.checked = true;
        Simulate.change(toggle);
      });
      await act(async () => {
        Simulate.submit(requireForm(host));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(
        useStore.getState().project.scene.objects.find((object) => object.kind === 'text'),
      ).toMatchObject({
        pathText: { guideObjectId: guide.id, offsetMm: 0, reverse: false },
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

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

  it('requires an unavailable edit font to be relinked before regenerating geometry', async () => {
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
      const save = Array.from(host.querySelectorAll('button')).find(
        (button) => button.textContent === 'Save',
      );
      expect(save).toBeInstanceOf(HTMLButtonElement);
      expect((save as HTMLButtonElement | undefined)?.disabled).toBe(true);
      expect(textMocks.loadFont).not.toHaveBeenCalled();
      expect(useStore.getState().project.scene.objects).toHaveLength(0);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('embeds an imported font and uses its stable project key', async () => {
    useUiStore.setState({ textDialog: { mode: 'add' } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<AddTextDialog />);
      });

      await act(async () => {
        const textarea = requireTextarea(host);
        textarea.value = 'Studio';
        Simulate.change(textarea);
      });
      const fontInput = requireInput(host, 'input[aria-label="Import font file"]');
      const bytes = new Uint8Array([79, 84, 84, 79, 0, 1, 0, 0]);
      const file = {
        name: 'Studio.otf',
        arrayBuffer: async () => bytes.buffer,
      } as File;
      Object.defineProperty(fontInput, 'files', { configurable: true, value: [file] });
      await act(async () => {
        Simulate.change(fontInput);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(host.textContent).toContain('Studio.otf');
      await act(async () => {
        requireForm(host).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      const embedded = useStore.getState().project.embeddedFonts?.[0];
      expect(embedded).toMatchObject({ fileName: 'Studio.otf' });
      expect(embedded?.key).toMatch(/^embedded:/);
      expect(useStore.getState().project.scene.objects[0]).toMatchObject({
        kind: 'text',
        fontKey: embedded?.key,
      });
      expect(textMocks.loadFont).toHaveBeenCalledWith(embedded?.key, [embedded]);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('clamps numeric text fields before rendering and saving', async () => {
    useUiStore.setState({ textDialog: { mode: 'add' } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<AddTextDialog />);
      });

      const textarea = requireTextarea(host);
      const size = requireInput(host, 'input[aria-label="Text size"]');
      const lineHeight = requireInput(host, 'input[aria-label="Text line height"]');
      const letterSpacing = requireInput(host, 'input[aria-label="Text letter spacing"]');
      const bend = requireInput(host, 'input[aria-label="Text bend"]');
      expect(size.max).toBe('300');
      expect(lineHeight.max).toBe('5');
      expect(letterSpacing.min).toBe('-0.5');
      expect(bend.min).toBe('-180');
      expect(bend.max).toBe('180');

      await act(async () => {
        textarea.value = 'Hello';
        Simulate.change(textarea);
        size.value = '9999';
        Simulate.change(size);
        lineHeight.value = '99';
        Simulate.change(lineHeight);
        letterSpacing.value = '-99';
        Simulate.change(letterSpacing);
        bend.value = '999';
        Simulate.change(bend);
      });

      const form = requireForm(host);
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      const renderInput = textMocks.textToPolylines.mock.calls[0]?.[0] as
        | {
            readonly sizeMm?: number;
            readonly lineHeight?: number;
            readonly letterSpacing?: number;
          }
        | undefined;
      expect(renderInput?.sizeMm).toBe(300);
      expect(renderInput?.lineHeight).toBe(5);
      expect(renderInput?.letterSpacing).toBe(-0.5);

      expect(
        useStore.getState().project.scene.objects.find((obj) => obj.kind === 'text'),
      ).toMatchObject({
        kind: 'text',
        sizeMm: 300,
        lineHeight: 5,
        letterSpacing: -0.5,
        bendDeg: 180,
      });
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('lets numeric text fields be fully cleared while retyping', async () => {
    useUiStore.setState({ textDialog: { mode: 'add' } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<AddTextDialog />);
      });

      const fields = [
        requireInput(host, 'input[aria-label="Text size"]'),
        requireInput(host, 'input[aria-label="Text line height"]'),
        requireInput(host, 'input[aria-label="Text letter spacing"]'),
        requireInput(host, 'input[aria-label="Text bend"]'),
      ];

      for (const input of fields) {
        const previous = input.value;
        await act(async () => {
          input.value = '';
          Simulate.change(input);
        });
        expect(input.value).toBe('');

        await act(async () => Simulate.blur(input));
        expect(input.value).toBe(previous);
      }
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});

function requireTextarea(host: HTMLElement): HTMLTextAreaElement {
  const textarea = host.querySelector('textarea');
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Text area not rendered');
  return textarea;
}

function requireInput(host: HTMLElement, selector: string): HTMLInputElement {
  const input = host.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${selector} not rendered`);
  return input;
}

function requireForm(host: HTMLElement): HTMLFormElement {
  const form = host.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('Text form not rendered');
  return form;
}
