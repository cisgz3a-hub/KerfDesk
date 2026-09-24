import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TracePreviewLoading } from './TracePreviewLoading';

it('shows actual stages and elapsed time without inventing a completion percentage', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<TracePreviewLoading isDecoding startedAt={100000} />));
    expect(host.textContent).toContain('Preparing image');
    await act(async () => vi.advanceTimersByTime(64000));
    expect(host.textContent).toContain('Elapsed 1:04');
    await act(async () =>
      root.render(<TracePreviewLoading isDecoding={false} phase="refining" startedAt={100000} />),
    );
    expect(host.textContent).toContain('Refining trace');
    expect(host.textContent).toContain('Elapsed 1:04');
    expect(host.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
    expect(host.textContent).not.toContain('%');
    await act(async () =>
      root.render(
        <TracePreviewLoading isDecoding={false} phase="preparing" startedAt={Date.now()} />,
      ),
    );
    expect(host.textContent).toContain('Elapsed 0:00');
  } finally {
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  }
});
