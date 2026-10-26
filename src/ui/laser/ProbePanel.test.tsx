// ProbePanel (ADR-103 G2): CNC-only visibility, Idle gating, and the
// built sequence handed to the store's probe action.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { markProbeCircuitTested } from '../state/probe-test-touch.test-support';
import { ProbePanel } from './ProbePanel';

const CLOSED_PROBE_PIN = { limitX: false, limitY: false, limitZ: false, probe: true, door: false };

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function idleStatus(): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    wco: null,
    feed: 0,
    spindle: 0,
  };
}

afterEach(() => {
  useStore.getState().setMachineKind('laser');
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    probeBusy: false,
    probeTestTouch: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

async function renderPanel(): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<ProbePanel />);
  });
  // Narrowing: assigned inside act.
  return { host, root: root as unknown as Root };
}

async function cleanup(host: HTMLDivElement, root: Root): Promise<void> {
  await act(async () => root.unmount());
  host.remove();
}

describe('ProbePanel', () => {
  it('renders nothing in laser mode', async () => {
    const { host, root } = await renderPanel();
    try {
      expect(host.textContent).toBe('');
    } finally {
      await cleanup(host, root);
    }
  });

  it('in CNC mode, disables Run until connected, Idle and the probe circuit is tested', async () => {
    useStore.getState().setMachineKind('cnc');
    const { host, root } = await renderPanel();
    try {
      const button = [...host.querySelectorAll('button')].find((control) =>
        control.textContent?.includes('Run probe'),
      );
      if (button === undefined) throw new Error('Run button missing');
      expect(button.disabled).toBe(true);
      await act(async () => {
        useLaserStore.setState({
          connection: { kind: 'connected' },
          statusReport: idleStatus(),
        } as Partial<ReturnType<typeof useLaserStore.getState>>);
      });
      // Meta audit M7-P2-1 (ADR-103 Amendment 2): no seek before a test touch.
      const circuit = (): string =>
        host.querySelector('[aria-label="Probe circuit"]')?.textContent ?? '';
      expect(button.disabled).toBe(true);
      expect(button.title).toContain('Test the probe first');
      expect(circuit()).toContain('Probe circuit: not tested');
      await act(async () => {
        useLaserStore.setState({
          statusReport: { ...idleStatus(), pins: CLOSED_PROBE_PIN },
        } as Partial<ReturnType<typeof useLaserStore.getState>>);
        markProbeCircuitTested();
      });
      expect(circuit()).toContain('Probe circuit: closed');
      expect(button.disabled).toBe(true);
      await act(async () => {
        useLaserStore.setState({ statusReport: idleStatus() } as Partial<
          ReturnType<typeof useLaserStore.getState>
        >);
      });
      expect(circuit()).toContain('Probe circuit: tested');
      expect(button.disabled).toBe(false);
    } finally {
      await cleanup(host, root);
    }
  });

  it('runs the Z sequence through the store probe action', async () => {
    useStore.getState().setMachineKind('cnc');
    const originalProbe = useLaserStore.getState().probe;
    const probe = vi.fn(async (_request: ProbeRequest) => ({ kind: 'ok' }) as const);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: idleStatus(),
      probe,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    markProbeCircuitTested();
    const { host, root } = await renderPanel();
    try {
      const button = [...host.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Run probe'),
      );
      if (button === undefined) throw new Error('Run button missing');
      await act(async () => {
        button.click();
      });
      expect(probe).toHaveBeenCalledTimes(1);
      const request = probe.mock.calls[0]?.[0];
      expect(request).toEqual({
        kind: 'z',
        params: expect.objectContaining({ plateThicknessMm: 15, maxTravelMm: 25 }),
      });
    } finally {
      useLaserStore.setState({ probe: originalProbe } as Partial<
        ReturnType<typeof useLaserStore.getState>
      >);
      await cleanup(host, root);
    }
  });
});
