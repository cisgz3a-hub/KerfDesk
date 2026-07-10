// CNC-04 — RunningControls shows a Continue button and the re-zero instruction
// while a job is held at an M0 tool change, and mounts Stop throughout.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { RunningControls } from './JobRunControls';

async function renderRunningControls(props: {
  isStreaming: boolean;
  isPaused: boolean;
  isToolChange: boolean;
}): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<RunningControls {...props} />);
  });
  return { host, root };
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (cleanup !== null) await cleanup();
  cleanup = null;
});

describe('RunningControls tool-change (CNC-04)', () => {
  it('shows Continue + the re-zero instruction and keeps Stop while held at a tool change', async () => {
    const { host, root } = await renderRunningControls({
      isStreaming: false,
      isPaused: false,
      isToolChange: true,
    });
    cleanup = async () => {
      await act(async () => root.unmount());
      host.remove();
    };

    expect(host.textContent).toContain('Continue');
    expect(host.textContent).toContain('Stop');
    expect(host.textContent).toContain('re-zero Z on the stock top');
    // Pause/Resume belong to streaming/paused, not a tool-change hold.
    expect(host.textContent).not.toContain('Pause');
    expect(host.textContent).not.toContain('Resume');
  });

  it('does not show Continue for an ordinary streaming job', async () => {
    const { host, root } = await renderRunningControls({
      isStreaming: true,
      isPaused: false,
      isToolChange: false,
    });
    cleanup = async () => {
      await act(async () => root.unmount());
      host.remove();
    };

    expect(host.textContent).not.toContain('Continue');
    expect(host.textContent).toContain('Pause');
  });
});
