import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { ProbeControls } from './ProbeControls';

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

async function renderControls(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ProbeControls />));
  return { host, root };
}

afterEach(() => {
  useStore.getState().setMachineKind('laser');
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    probeBusy: false,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('ProbeControls corner geometry', () => {
  it('shows the measured geometry and sends it in the typed corner request', async () => {
    useStore.getState().setMachineKind('cnc');
    const originalProbe = useLaserStore.getState().probe;
    const probe = vi.fn(async (_request: ProbeRequest) => ({ kind: 'ok' }) as const);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: idleStatus(),
      probe,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, root } = await renderControls();
    try {
      const mode = host.querySelector<HTMLSelectElement>('select[aria-label="Probe mode"]');
      if (mode === null) throw new Error('Probe mode missing');
      await act(async () => {
        mode.value = 'corner';
        mode.dispatchEvent(new Event('change', { bubbles: true }));
      });

      expect(
        host.querySelector<HTMLInputElement>('input[aria-label="Plate center X offset"]')?.value,
      ).toBe('15');
      expect(
        host.querySelector<HTMLInputElement>('input[aria-label="Plate center Y offset"]')?.value,
      ).toBe('15');
      expect(
        host.querySelector<HTMLInputElement>('input[aria-label="Side probe drop"]')?.value,
      ).toBe('6');
      expect(
        host.querySelector<HTMLInputElement>('input[aria-label="Side clearance"]')?.value,
      ).toBe('35');

      const run = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Run probe'),
      );
      if (run === undefined) throw new Error('Run probe missing');
      await act(async () => {
        run.click();
        await Promise.resolve();
      });
      expect(probe).toHaveBeenCalledWith({
        kind: 'corner',
        params: expect.objectContaining({
          toolKind: 'end-mill',
          plateCenterOffsetXmm: 15,
          plateCenterOffsetYmm: 15,
          sideDropMm: 6,
          sideClearanceMm: 35,
        }),
      });
    } finally {
      await act(async () => {
        useLaserStore.setState({ probe: originalProbe } as Partial<
          ReturnType<typeof useLaserStore.getState>
        >);
        root.unmount();
      });
      host.remove();
    }
  });

  it('disables XYZ probing when the active tool has no cylindrical flank', async () => {
    useStore.getState().setMachineKind('cnc');
    const project = useStore.getState().project;
    if (project.machine?.kind !== 'cnc') throw new Error('CNC machine missing');
    useStore.setState({
      project: {
        ...project,
        machine: {
          ...project.machine,
          toolId: 'test-v-bit',
          tools: [
            {
              id: 'test-v-bit',
              name: 'Test V-bit',
              kind: 'v-bit',
              diameterMm: 6.35,
              tipAngleDeg: 60,
            },
          ],
        },
      },
    });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: idleStatus(),
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, root } = await renderControls();
    try {
      const mode = host.querySelector<HTMLSelectElement>('select[aria-label="Probe mode"]');
      if (mode === null) throw new Error('Probe mode missing');
      await act(async () => {
        mode.value = 'corner';
        mode.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const run = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Run probe'),
      );
      if (run === undefined) throw new Error('Run probe missing');
      expect(run.disabled).toBe(true);
      expect(run.title).toContain('cylindrical end mill');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
