import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import type { TextRenderResult } from '../../core/text';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';

const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./render-text-geometry', () => ({ renderTextGeometry: mocks.render }));
vi.mock('./font-loader', () => ({
  cssFamilyForFont: (key: string) => `lf2-${key}`,
  ensureFontCss: vi.fn(async () => undefined),
  loadFont: vi.fn(async () => new ArrayBuffer(8)),
}));
import { AddTextDialog } from './AddTextDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const rendered: TextRenderResult = {
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  resetStore();
  mocks.render.mockReset();
  useUiStore.setState({ textDialog: null });
});

async function startRender() {
  let resolve!: (value: TextRenderResult) => void;
  let reject!: (reason: Error) => void;
  mocks.render.mockReturnValueOnce(
    new Promise<TextRenderResult>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
  );
  useUiStore.setState({ textDialog: { mode: 'add' } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <StrictMode>
        <AddTextDialog />
      </StrictMode>,
    ),
  );
  await act(async () => {
    const textarea = host.querySelector('textarea')!;
    textarea.value = 'Pending text';
    Simulate.change(textarea);
  });
  await act(async () => Simulate.submit(host.querySelector('form')!));
  expect(mocks.render).toHaveBeenCalledTimes(1);
  return {
    host,
    resolve,
    reject,
    root,
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it.each(['escape', 'new-project', 'unmount'] as const)(
  'retires pending text on %s',
  async (cancel) => {
    const h = await startRender();
    try {
      await act(async () => {
        if (cancel === 'escape')
          h.host
            .querySelector('textarea')!
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        else if (cancel === 'new-project') useStore.getState().newProject();
        else h.root.render(null);
      });
      const project = useStore.getState().project;
      await act(async () => h.resolve(rendered));
      expect(useStore.getState().project).toBe(project);
      expect(useStore.getState().project.scene.objects).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  },
);

it('keeps unrelated same-document edits and inserts one current text after StrictMode replay', async () => {
  const h = await startRender();
  try {
    await act(async () => useStore.getState().importSvgObject(svgObj('unrelated', ['#000000'])));
    await act(async () => h.resolve(rendered));
    expect(useStore.getState().project.scene.objects.map((object) => object.kind)).toEqual([
      'imported-svg',
      'text',
    ]);
    expect(useUiStore.getState().textDialog).toBeNull();
  } finally {
    await h.dispose();
  }
});

it('a cancelled render failure does not report an error into a reopened dialog', async () => {
  const h = await startRender();
  try {
    await act(async () => useUiStore.getState().closeTextDialog());
    await act(async () => useUiStore.setState({ textDialog: { mode: 'add' } }));
    const dialog = useUiStore.getState().textDialog;
    const toasts = useToastStore.getState().toasts;
    await act(async () => h.reject(new Error('late failure')));
    expect(useToastStore.getState().toasts).toBe(toasts);
    expect(useUiStore.getState().textDialog).toBe(dialog);
  } finally {
    await h.dispose();
  }
});
