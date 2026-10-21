import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { createLayer } from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import { projectWithVariants } from '../state/testing/scene-clipboard-fixtures';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { useToastStore } from '../state/toast-store';
import { AddTextDialog } from './AddTextDialog';
import { buildTextObject } from './build-text-object';

vi.mock(import('./build-text-object'), async (importOriginal) => ({
  ...(await importOriginal()),
  buildTextObject: vi.fn(),
}));
vi.mock(import('./font-loader'), async (importOriginal) => ({
  ...(await importOriginal()),
  ensureFontCss: vi.fn(async () => undefined),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps the text draft open when the proposed insert exceeds the operation limit', async () => {
  resetStore();
  useToastStore.setState({ toasts: [] });
  const object = projectWithVariants().scene.objects.find((object) => object.kind === 'text');
  if (object?.kind !== 'text') throw new Error('Missing text fixture');
  vi.mocked(buildTextObject).mockResolvedValue({ ...object, fontKey: 'roboto-regular' });
  const before = useStore.getState().project;
  const project = {
    ...before,
    scene: {
      ...before.scene,
      layers: Array.from({ length: 256 }, (_, index) =>
        createLayer({ id: `operation-${index}`, color: `#${index.toString(16).padStart(6, '0')}` }),
      ),
    },
  };
  useStore.setState({ project });
  useUiStore.setState({ textDialog: { mode: 'add' } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AddTextDialog />));
    const textarea = host.querySelector('textarea');
    const form = host.querySelector('form');
    if (textarea === null || form === null) throw new Error('Text form not rendered');
    await act(async () => {
      textarea.value = 'Keep my text';
      Simulate.change(textarea);
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(buildTextObject).toHaveBeenCalled();
    expect(useStore.getState().project).toBe(project);
    expect(useUiStore.getState().textDialog).toEqual({ mode: 'add' });
    expect(textarea.value).toBe('Keep my text');
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('256 operations');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    useUiStore.setState({ textDialog: null });
  }
});
