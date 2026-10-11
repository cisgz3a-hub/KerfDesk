import { afterEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../state/toast-store';
import { createImportWorkerControls } from './import-worker-controls';

afterEach(() => {
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
});

describe('createImportWorkerControls', () => {
  it('reports phase progress and Escape cancellation', () => {
    const pushToast = vi.fn();
    const controls = createImportWorkerControls('part.stl', pushToast);

    controls.options.onProgress?.({ phase: 'queued', queuePosition: 2 });
    controls.options.onProgress?.({ phase: 'parsing', queuePosition: 0 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    const key = { key: expect.stringMatching(/^import-progress-/) };
    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/queued behind 2/), 'info', key);
    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/parsing in worker/), 'info', key);
    expect(controls.options.signal?.aborted).toBe(true);
    controls.dispose();
  });

  it('removes its Escape listener after completion', () => {
    const controls = createImportWorkerControls('part.dxf', vi.fn());
    controls.dispose();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(controls.options.signal?.aborted).toBe(false);
  });

  it('keeps one progress toast per import and removes it when the import settles', () => {
    const { pushToast } = useToastStore.getState();
    const controls = createImportWorkerControls('grid.svg', pushToast);

    controls.options.onProgress?.({ phase: 'reading', queuePosition: 0 });
    controls.options.onProgress?.({ phase: 'parsing', queuePosition: 0 });
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'grid.svg: parsing in worker. Press Esc to cancel.',
    ]);

    pushToast('Imported grid.svg.', 'success');
    controls.dispose();
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'Imported grid.svg.',
    ]);
  });

  it('gives concurrent imports their own progress toasts', () => {
    const { pushToast } = useToastStore.getState();
    const first = createImportWorkerControls('a.svg', pushToast);
    const second = createImportWorkerControls('b.svg', pushToast);

    first.options.onProgress?.({ phase: 'parsing', queuePosition: 0 });
    second.options.onProgress?.({ phase: 'queued', queuePosition: 1 });
    expect(useToastStore.getState().toasts).toHaveLength(2);

    first.dispose();
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'b.svg: queued behind 1 import(s). Press Esc to cancel.',
    ]);
    second.dispose();
  });
});
