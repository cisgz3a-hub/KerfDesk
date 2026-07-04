// DeviceSetupProbeStep (F-CNC20): the wizard's optional touch-plate step hosts
// the probe controls for CNC and a skip note for laser.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { DeviceSetupProbeStep } from './DeviceSetupProbeStep';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetStore());

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<DeviceSetupProbeStep />);
  });
  return { host, root };
}

describe('DeviceSetupProbeStep', () => {
  it('hosts the probe controls in CNC mode', async () => {
    useStore.getState().setMachineKind('cnc');
    const { host, root } = await render();
    try {
      expect(host.querySelector('select[aria-label="Probe mode"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('shows a skip note (no probe controls) in laser mode', async () => {
    const { host, root } = await render();
    try {
      expect(host.querySelector('select[aria-label="Probe mode"]')).toBeNull();
      expect(host.textContent).toContain('applies to CNC machines');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
