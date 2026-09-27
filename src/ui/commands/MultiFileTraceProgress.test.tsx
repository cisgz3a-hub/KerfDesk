import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { beginMultiFileTraceProgress, MultiFileTraceProgressPanel } from './MultiFileTraceProgress';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Multi-File Trace progress panel', () => {
  it('shows Tracing i of N non-modally and cancels the batch', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<MultiFileTraceProgressPanel />));
    expect(host.querySelector('[role="status"]')).toBeNull();

    const abort = vi.fn();
    let progress: ReturnType<typeof beginMultiFileTraceProgress> | null = null;
    act(() => {
      progress = beginMultiFileTraceProgress(3, abort);
      progress.update(2);
    });
    const status = host.querySelector('[role="status"][aria-label="Multi-File Trace progress"]');
    expect(status?.textContent).toContain('Tracing 2 of 3');
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();

    const cancel = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Cancel Multi-File Trace"]',
    );
    act(() => cancel?.click());
    expect(abort).toHaveBeenCalledTimes(1);
    expect(status?.textContent).toContain('Cancelling Multi-File Trace...');
    expect(cancel?.disabled).toBe(true);

    act(() => progress?.end());
    expect(host.querySelector('[role="status"]')).toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});
