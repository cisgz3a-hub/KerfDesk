// The rail's Connect must open the transport with the same options as the menu
// Connect, including the profile's "Stream in worker" opt-in (ADR-334). It
// rebuilt the options by hand without it, so the stop-and-go mitigation was
// silently ignored (controller audit 2026-09-23, connect-6 / ui-panel-7).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { ControllerConnectionControls } from './ControllerConnectionControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalConnect = useLaserStore.getState().connect;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

afterEach(() => {
  useLaserStore.setState({ connect: originalConnect });
  useStore.setState({ project: createProject() });
});

async function clickConnect(): Promise<unknown> {
  const connect = vi.fn<ReturnType<typeof useLaserStore.getState>['connect']>(
    async () => undefined,
  );
  useLaserStore.setState({ connect });
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={platform}>
        <ControllerConnectionControls
          machineKind="laser"
          autofocusBusy={false}
          motionOperation={null}
          controllerOperation={null}
          onForget={() => undefined}
        />
      </PlatformProvider>,
    );
  });
  try {
    const button = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Connect…',
    );
    if (button === undefined) throw new Error('Connect button missing');
    await act(async () => {
      button.click();
    });
    return connect.mock.calls[0]?.[1];
  } finally {
    await act(async () => root?.unmount());
    host.remove();
  }
}

function setDevice(workerHostedStreaming: boolean): void {
  useStore.setState((state) => ({
    project: {
      ...state.project,
      device: { ...state.project.device, controllerKind: 'grblhal', workerHostedStreaming },
    },
  }));
}

describe('rail Connect options', () => {
  it('honours the profile opt-in to stream in the worker', async () => {
    setDevice(true);
    expect(await clickConnect()).toMatchObject({
      controllerKind: 'grblhal',
      hostedStreaming: true,
    });
  });

  it('leaves the worker off when the profile does not opt in', async () => {
    setDevice(false);
    expect(await clickConnect()).not.toHaveProperty('hostedStreaming');
  });
});
