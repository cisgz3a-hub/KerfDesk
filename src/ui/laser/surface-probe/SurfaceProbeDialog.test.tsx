import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { PlatformProvider } from '../../app/platform-context';
import type { PlatformAdapter } from '../../../platform/types';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { SurfaceProbeDialog } from './SurfaceProbeDialog';
import type { SurfaceGridResult } from '../../../core/controllers/grbl/surface-grid-probe';
import { parseStatusReport } from '../../../core/controllers/grbl';

const originalProject = useStore.getState().project;
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: originalProject });
});

it('requires prepared clearance, preserves an active measurement on Close, and saves the reviewed CSV locally', async () => {
  const write = vi.fn(async () => undefined);
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => ({ displayName: 'surface.csv', write }),
    serial: { isSupported: () => true, requestPort: async () => null },
  };
  useStore.setState({
    project: {
      ...originalProject,
      device: { ...originalProject.device, capabilities: ['z-axis'], zProbePresent: true },
    },
  });
  useLaserStore.setState({
    connection: { kind: 'connected' },
    statusReport: parseStatusReport('<Idle|MPos:0,0,10|FS:0,0>'),
    controllerSettings: { reportInches: false },
    controllerSettingsObservation: { sessionEpoch: 0, observedAt: 1 },
  });
  let finish: ((result: SurfaceGridResult) => void) | undefined;
  const measure = vi.spyOn(useLaserStore.getState(), 'measureSurfaceGrid').mockImplementation(
    (request) =>
      new Promise((resolve) => {
        finish = resolve;
        expect(request.clearancePrepared).toBe(true);
      }),
  );
  const onClose = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <PlatformProvider adapter={platform}>
          <SurfaceProbeDialog onClose={onClose} />
        </PlatformProvider>,
      ),
    );
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((item) => item.textContent === label);
    expect(button('Measure grid')?.disabled).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')?.click());
    await act(async () => button('Measure grid')?.click());
    expect(measure).toHaveBeenCalledTimes(1);
    await act(async () => button('Close')?.click());
    expect(onClose).not.toHaveBeenCalled();
    const request = measure.mock.calls[0]?.[0];
    if (request === undefined) throw new Error('Missing captured request');
    await act(async () =>
      finish?.({
        kind: 'ok',
        measurement: {
          request,
          points: [{ row: 0, column: 0, x: 0, y: 0, z: 1.2, machineZ: -3.8 }],
          activeWcs: 'G54',
          offsetMm: { x: 100, y: 200, z: -5 },
          clearanceZMm: 10,
          reportInches: false,
          sessionEpoch: 0,
          measuredAt: 1,
          complete: true,
        },
      }),
    );
    expect(host.textContent).toContain('1.2000');
    await act(async () => button('Save reviewed CSV…')?.click());
    expect(write).toHaveBeenCalledWith(expect.stringContaining('0.0000,0.0000,1.2000,-3.8000'));
  } finally {
    await act(async () => root.unmount());
  }
});
