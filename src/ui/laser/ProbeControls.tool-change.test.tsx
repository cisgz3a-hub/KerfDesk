// A tool-change hold offers the Z cycle only (controller audit v2 C2-P1-1,
// ADR-375 Amendment 3). The probe draft keeps its mode for the whole document
// and controller session, so an XYZ corner draft from the morning setup must
// not become the touch-off for the second bit.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport, StreamerState } from '../../core/controllers/grbl';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { markProbeCircuitTested } from '../state/probe-test-touch.test-support';
import { ProbeControls } from './ProbeControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type LaserPatch = Partial<ReturnType<typeof useLaserStore.getState>>;

const IDLE: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 0,
};
const originalProbe = useLaserStore.getState().probe;

afterEach(() => {
  useStore.getState().setMachineKind('laser');
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    probeBusy: false,
    streamer: null,
    probe: originalProbe,
  } as LaserPatch);
});

describe('ProbeControls in a tool-change hold', () => {
  it('runs the Z cycle and greys out XYZ corner, keeping the draft for later', async () => {
    useStore.getState().setMachineKind('cnc');
    const probe = vi.fn(async (_request: ProbeRequest) => ({ kind: 'ok' }) as const);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: IDLE,
      probe,
    } as LaserPatch);
    markProbeCircuitTested();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<ProbeControls />));
    try {
      const mode = (): HTMLSelectElement => {
        const select = host.querySelector<HTMLSelectElement>('select[aria-label="Probe mode"]');
        if (select === null) throw new Error('Probe mode missing');
        return select;
      };
      await act(async () => {
        mode().value = 'corner';
        mode().dispatchEvent(new Event('change', { bubbles: true }));
      });

      await act(async () => {
        useLaserStore.setState({ streamer: { status: 'tool-change' } as StreamerState });
      });
      expect(mode().value).toBe('z');
      expect(host.querySelector<HTMLOptionElement>('option[value="corner"]')?.disabled).toBe(true);
      expect(host.textContent).toContain('Tool change: probe Z only.');
      const run = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Run probe'),
      );
      if (run === undefined) throw new Error('Run probe missing');
      await act(async () => {
        run.click();
        await Promise.resolve();
      });
      expect(probe).toHaveBeenCalledWith(expect.objectContaining({ kind: 'z' }));

      // After the job the remembered XYZ corner mode is back.
      await act(async () => {
        useLaserStore.setState({ streamer: null });
      });
      expect(mode().value).toBe('corner');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
