import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type EmbeddedFont, type TextObject } from '../../core/scene';
import type { TextRenderResult } from '../../core/text';
import type * as TextWorkerSession from './text-worker-session';

const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./text-worker-session', async (importOriginal) => ({
  ...(await importOriginal<typeof TextWorkerSession>()),
  renderTextGeometryOffThread: mocks.render,
}));
vi.mock('./font-loader', () => ({
  cssFamilyForFont: (key: string) => key,
  ensureFontCss: vi.fn(async () => undefined),
  loadFont: vi.fn(async () => new ArrayBuffer(8)),
}));
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { AddTextDialog } from './AddTextDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const bytes = (i: number) => new Uint8Array([79, 84, 84, 79, 0, 1, 2, i]);
const font = (i: number): EmbeddedFont => ({
  key: 'embedded:' + i,
  fileName: i + '.otf',
  dataBase64: btoa(String.fromCharCode(...bytes(i))),
});
const text = (i: number): TextObject => ({
  kind: 'text',
  id: 't' + i,
  content: 'Sign',
  fontKey: font(i).key,
  sizeMm: 12,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  color: '#000000',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
  transform: IDENTITY_TRANSFORM,
  paths: [],
});
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

it('retains the draft when Undo fills the font budget during rendering, then lets it retry', async () => {
  resetStore();
  for (let i = 0; i < 32; i++) useStore.getState().upsertTextObject(text(i), font(i));
  useStore.getState().removeSceneObject('t31');
  useUiStore.setState({ textDialog: { mode: 'add' } });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let finish: (value: TextRenderResult) => void = () => undefined;
  mocks.render.mockReturnValue(
    new Promise<TextRenderResult>((resolve) => {
      finish = resolve;
    }),
  );
  try {
    await act(async () => root.render(<AddTextDialog />));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Import font file"]');
    if (input === null) throw new Error('Missing font picker');
    Object.defineProperty(input, 'files', {
      value: [{ name: '99.otf', arrayBuffer: async () => bytes(99).buffer }],
      configurable: true,
    });
    await act(async () => Simulate.change(input));
    const textarea = host.querySelector('textarea');
    const form = host.querySelector('form');
    if (textarea === null || form === null) throw new Error('Missing form');
    await act(async () => {
      textarea.value = 'Keep this draft';
      Simulate.change(textarea);
    });
    await act(async () => Simulate.submit(form));
    expect(mocks.render).toHaveBeenCalledOnce();
    // Same-document history edits can arrive from a remote design session.
    await act(async () => useStore.getState().undo());
    const before = useStore.getState().project;
    await act(async () => finish(rendered));
    expect(useStore.getState().project).toBe(before);
    expect(useUiStore.getState().textDialog).not.toBeNull();
    expect(host.querySelector('textarea')?.value).toBe('Keep this draft');
    expect(
      useToastStore.getState().toasts.some((t) => t.message.includes('32 imported fonts')),
    ).toBe(true);

    await act(async () => useStore.getState().removeSceneObject('t31'));
    await act(async () => Simulate.submit(form));
    expect(useUiStore.getState().textDialog).toBeNull();
    expect(
      useStore
        .getState()
        .project.scene.objects.some((o) => o.kind === 'text' && o.content === 'Keep this draft'),
    ).toBe(true);
    expect(useStore.getState().project.embeddedFonts).toHaveLength(32);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    resetStore();
    useUiStore.setState({ textDialog: null });
  }
});
