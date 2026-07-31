import { describe, expect, it, vi } from 'vitest';
import { createImportWorkerControls } from './import-worker-controls';

describe('createImportWorkerControls', () => {
  it('reports phase progress and Escape cancellation', () => {
    const pushToast = vi.fn();
    const controls = createImportWorkerControls('part.stl', pushToast);

    controls.options.onProgress?.({ phase: 'queued', queuePosition: 2 });
    controls.options.onProgress?.({ phase: 'parsing', queuePosition: 0 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/queued behind 2/), 'info');
    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/parsing in worker/), 'info');
    expect(controls.options.signal?.aborted).toBe(true);
    controls.dispose();
  });

  it('removes its Escape listener after completion', () => {
    const controls = createImportWorkerControls('part.dxf', vi.fn());
    controls.dispose();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(controls.options.signal?.aborted).toBe(false);
  });
});
