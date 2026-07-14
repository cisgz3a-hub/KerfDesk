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
  it('keeps ABORT available but disables unsafe automatic Resume', async () => {
    useLaserStore.setState({ activeJobMachineKind: 'cnc' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    await act(async () => {
      root.render(<RunningControls isStreaming={false} isPaused={true} isToolChange={false} />);
    });

    const buttons = [...host.querySelectorAll('button')];
    const resume = buttons.find((button) => button.textContent === 'Resume');
    const abort = buttons.find((button) => button.textContent === 'ABORT');
    expect(resume?.disabled).toBe(true);
    expect(resume?.title).toMatch(/cannot prove.*spindle/i);
    expect(abort?.disabled).toBe(false);
    expect(host.textContent).toMatch(/newly reviewed recovery job/i);
  });
});
