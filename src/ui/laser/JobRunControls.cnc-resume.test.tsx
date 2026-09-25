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
  useLaserStore.setState({ activeJobMachineKind: null, controllerSettings: null });
});

describe('RunningControls CNC Resume advisory', () => {
  // ADR-180 amendment: the rail no longer explains a refusal — it shows the
  // spindle-check advisory beside the (LiveMotionBar-owned) Resume action.
  it('shows the spindle-check advisory without duplicating top-bar actions', async () => {
    useLaserStore.setState({
      activeJobMachineKind: 'cnc',
      controllerSettings: { laserModeEnabled: false },
    });
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
    expect(host.textContent).toMatch(/restarts the spindle/i);
    expect(host.textContent).toMatch(/spins back up\s+engaged/i);
  });

  // Unread $32 is uncertainty, not proof that the controller is in laser mode.
  it('describes the spin-up risk conditionally while $32 is unconfirmed', async () => {
    useLaserStore.setState({ activeJobMachineKind: 'cnc', controllerSettings: null });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    await act(async () => {
      root.render(<RunningControls isStreaming={false} isPaused={true} isToolChange={false} />);
    });

    expect(host.textContent).toContain('may restart motion without spindle spin-up');
    expect(host.textContent).not.toMatch(/NO\s+spindle spin-up/);
    expect(host.textContent).not.toMatch(/restarts the spindle/i);
  });
});
