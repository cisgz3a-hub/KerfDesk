// ProbeControls is mounted in three places (the CNC Material & Bit rail, the
// Device-Setup wizard step, ProbePanel). With the form in component state each
// mount kept a private copy, so plate geometry and probe depths dialled in one
// were absent from the other — which then probed with defaults and zeroed Z at
// the wrong height.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { ProbeControls } from './ProbeControls';
import { DEFAULT_CORNER_PROBE_GEOMETRY, useProbeFormStore } from './probe-form-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useStore.getState().setMachineKind('laser');
  useProbeFormStore.setState({
    mode: 'z',
    corner: 'front-left',
    bitDiameterMm: null,
    bitDiameterToolId: null,
    cornerGeometry: DEFAULT_CORNER_PROBE_GEOMETRY,
  });
});

async function mount(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ProbeControls />));
  return { host, root };
}

function select(host: HTMLElement, label: string): HTMLSelectElement {
  const found = host.querySelector(`select[aria-label="${label}"]`);
  if (!(found instanceof HTMLSelectElement)) throw new Error(`${label} select missing`);
  return found;
}

describe('ProbeControls shared form', () => {
  it('shows one mount’s probe mode on every other mount', async () => {
    useStore.getState().setMachineKind('cnc');
    const rail = await mount();
    const wizard = await mount();
    try {
      const railMode = select(rail.host, 'Probe mode');
      expect(select(wizard.host, 'Probe mode').value).toBe('z');

      await act(async () => {
        railMode.value = 'corner';
        Simulate.change(railMode);
      });

      // Both surfaces describe the same pending probe.
      expect(select(wizard.host, 'Probe mode').value).toBe('corner');
      expect(useProbeFormStore.getState().mode).toBe('corner');
    } finally {
      await act(async () => rail.root.unmount());
      await act(async () => wizard.root.unmount());
      rail.host.remove();
      wizard.host.remove();
    }
  });
});
