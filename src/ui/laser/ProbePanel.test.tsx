// ProbePanel (ADR-103 G2): CNC-only visibility, Idle gating, and the
// built sequence handed to the store's probe action.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { ProbePanel } from './ProbePanel';

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

  it('in CNC mode, disables Run until connected and Idle', async () => {
    useStore.getState().setMachineKind('cnc');
    const { host, root } = await renderPanel();
    try {
      const button = host.querySelector('button');
      if (button === null) throw new Error('Run button missing');
      expect(button.disabled).toBe(true);
      await act(async () => {
        useLaserStore.setState({
          connection: { kind: 'connected' },
          statusReport: idleStatus(),
        } as Partial<ReturnType<typeof useLaserStore.getState>>);
      });
      expect(button.disabled).toBe(false);
    } finally {
      await cleanup(host, root);
    }
  });

  it('runs the Z sequence through the store probe action', async () => {
    useStore.getState().setMachineKind('cnc');
    const originalProbe = useLaserStore.getState().probe;
    const probe = vi.fn(async (_lines: ReadonlyArray<string>) => ({ kind: 'ok' }) as const);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: idleStatus(),
      probe,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
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
      const lines = probe.mock.calls[0]?.[0] ?? [];
      expect(lines[0]).toBe('G21');
      expect(lines.some((line: string) => line.startsWith('G38.2 Z-'))).toBe(true);
      expect(lines.some((line: string) => line.startsWith('G10 L20 P0 Z'))).toBe(true);
    } finally {
      useLaserStore.setState({ probe: originalProbe } as Partial<
        ReturnType<typeof useLaserStore.getState>
      >);
      await cleanup(host, root);
    }
  });
});
