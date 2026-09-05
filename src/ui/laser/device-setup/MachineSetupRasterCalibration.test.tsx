import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { MachineSetupDialogHost } from './MachineSetupDialogHost';
import { openMachineSetup, useMachineSetupDialogStore } from './machine-setup-dialog-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const adapter: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

afterEach(() => {
  resetStore();
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' }, configuredRevision: 0 });
});

describe('Machine Setup raster calibration production entrypoint', () => {
  it('retains unapplied measurements and convention when diagnostics is collapsed and reopened', async () => {
    const view = await renderHost();
    try {
      await openDiagnostics(view.host);
      await change(view.host, 'Scan-offset input convention', 'lightburn-half-both-directions');
      await change(view.host, 'Measured offset 1', '0.123');
      const summary = [...view.host.querySelectorAll('summary')].find((item) =>
        item.textContent?.includes('Raster Diagnostics'),
      );
      const details = summary?.parentElement;
      if (!(details instanceof HTMLDetailsElement)) throw new Error('Expected disclosure');
      await act(async () => {
        details.open = false;
        Simulate.toggle(details);
      });
      await expandDiagnostics(view.host);
      expect(field(view.host, 'Measured offset 1').value).toBe('0.123');
      expect(field(view.host, 'Scan-offset input convention').value).toBe(
        'lightburn-half-both-directions',
      );
      expect(useStore.getState().project.device.scanningOffsets).toEqual([]);
    } finally {
      await view.unmount();
    }
  });

  it('exposes diagnostics and conversion without changing the live profile on Apply or Cancel', async () => {
    const before = useStore.getState();
    const view = await renderHost();
    try {
      await openDiagnostics(view.host);
      expect(view.host.textContent).toContain('Likely Causes');
      await change(view.host, 'Scan-offset input convention', 'lightburn-half-both-directions');
      await change(view.host, 'Scan-offset speed unit', 'mm-per-second');
      await change(view.host, 'Measured speed 1', '50');
      await change(view.host, 'Measured offset 1', '0.1');
      await click(view.host, 'Apply measured offsets');
      expect(view.host.textContent).toContain('Verification pending');
      await click(view.host, 'Mark verified');
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().dirty).toBe(before.dirty);
      expect(useStore.getState().undoStack).toBe(before.undoStack);
      await click(view.host, 'Cancel without saving');
      expect(useStore.getState().project).toBe(before.project);
      await openDiagnostics(view.host);
      expect(field(view.host, 'Measured offset 1').value).toBe('');
    } finally {
      await view.unmount();
    }
  });

  it('saves the converted table and provenance once through final Save, with Undo', async () => {
    const before = useStore.getState();
    const view = await renderHost();
    try {
      await openDiagnostics(view.host);
      await change(view.host, 'Scan-offset input convention', 'lightburn-half-both-directions');
      await change(view.host, 'Scan-offset speed unit', 'mm-per-second');
      await change(view.host, 'Measured speed 1', '50');
      await change(view.host, 'Measured offset 1', '-0.1');
      await click(view.host, 'Apply measured offsets');
      await click(view.host, 'Mark verified');
      await click(view.host, 'Review & save');
      await click(view.host, 'Save machine setup');
      expect(useStore.getState().project.device.scanningOffsets).toEqual([
        { speedMmPerMin: 3000, offsetMm: -0.2 },
      ]);
      expect(useStore.getState().project.device.scanOffsetCalibrationStatus).toBe('verified');
      expect(useStore.getState().undoStack.length).toBe(before.undoStack.length + 1);
      await act(async () => useStore.getState().undo());
      expect(useStore.getState().project.device).toEqual(before.project.device);
    } finally {
      await view.unmount();
    }
  });

  it.each(['new', 'open'])(
    'replaces the entire setup draft when the document changes via %s',
    async (action) => {
      const view = await renderHost();
      try {
        await openDiagnostics(view.host);
        await change(view.host, 'Measured offset 1', '0.2');
        await click(view.host, 'Apply measured offsets');
        await act(async () => {
          const store = useStore.getState();
          if (action === 'new') store.newProject();
          else
            store.setProject({
              ...store.project,
              device: { ...store.project.device, name: 'Opened machine' },
            });
        });
        await expandDiagnostics(view.host);
        expect(field(view.host, 'Measured offset 1').value).toBe('');
        await click(view.host, 'Review & save');
        await click(view.host, 'Save machine setup');
        expect(useStore.getState().project.device.scanningOffsets).toEqual([]);
        if (action === 'open')
          expect(useStore.getState().project.device.name).toBe('Opened machine');
      } finally {
        await view.unmount();
      }
    },
  );
});

async function renderHost() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | undefined;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={adapter}>
        <MachineSetupDialogHost />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      await act(async () => root?.unmount());
      host.remove();
    },
  };
}

async function openDiagnostics(host: HTMLElement): Promise<void> {
  await act(async () => openMachineSetup({ kind: 'step', step: 'options' }));
  await expandDiagnostics(host);
}

async function expandDiagnostics(host: HTMLElement): Promise<void> {
  const summary = [...host.querySelectorAll('summary')].find((item) =>
    item.textContent?.includes('Raster Diagnostics'),
  );
  if (summary === undefined)
    throw new Error('Raster Diagnostics must be reachable from Machine Setup');
  await act(async () => {
    const details = summary.parentElement;
    if (!(details instanceof HTMLDetailsElement)) throw new Error('Expected disclosure');
    details.open = true;
    Simulate.toggle(details);
  });
}

function field(host: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement {
  const match = host.querySelector(`[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement) && !(match instanceof HTMLSelectElement))
    throw new Error(`Missing field ${label}`);
  return match;
}

async function change(host: HTMLElement, label: string, value: string): Promise<void> {
  await act(async () => {
    const input = field(host, label);
    input.value = value;
    Simulate.change(input);
  });
}

async function click(host: HTMLElement, label: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(label),
  );
  if (button === undefined) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
}
