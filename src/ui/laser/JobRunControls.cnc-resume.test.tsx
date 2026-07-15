import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { RunningControls } from './JobRunControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ readonly host: HTMLElement; readonly root: ReturnType<typeof createRoot> }> =
  [];

afterEach(async () => {
  for (const { host, root } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  useLaserStore.setState({ activeJobMachineKind: null });
});

describe('RunningControls CNC Resume policy', () => {
  it('keeps the unsafe-resume explanation without duplicating top-bar actions', async () => {
    useLaserStore.setState({ activeJobMachineKind: 'cnc' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    await act(async () => {
      root.render(<RunningControls isStreaming={false} isPaused={true} isToolChange={false} />);
    });

    const labels = [...host.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).not.toContain('Resume');
    expect(labels).not.toContain('ABORT JOB');
    expect(labels).not.toContain('ABORT');
    expect(host.textContent).toMatch(/cannot prove.*spindle/i);
    expect(host.textContent).toMatch(/newly reviewed recovery job/i);
  });
});
