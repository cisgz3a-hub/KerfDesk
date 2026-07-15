import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { FileOpenRequest, FileSaveRequest, PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { DeviceSetupWizard } from './DeviceSetupWizard';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const IDLE_STATUS = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 0,
} as const;

function mockPlatform(serialSupported = true): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: vi.fn(async (_request: FileOpenRequest) => []),
    pickFileForSave: vi.fn(async (_request: FileSaveRequest) => null),
    serial: { isSupported: () => serialSupported, requestPort: async () => null },
  };
}

async function renderWizard(
  onClose: () => void = () => undefined,
  adapter: PlatformAdapter = mockPlatform(),
): Promise<{ readonly host: HTMLDivElement; readonly unmount: () => Promise<void> }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={adapter}>
        <DeviceSetupWizard onClose={onClose} />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    detectedSettings: null,
    detectedControllerKind: null,
    activeControllerKind: 'grbl-v1.1',
    statusReport: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('DeviceSetupWizard', () => {
  it('opens controller-first and shows one seven-step setup sequence', async () => {
    const view = await renderWizard();
    try {
      expect(view.host.textContent).toContain('Step 1 of 7 — Machine & controller');
      expect(view.host.textContent).toContain('Start here before connecting.');
      expect(view.host.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
      expect(
        view.host.querySelectorAll('nav[aria-label="Machine Setup steps"] button'),
      ).toHaveLength(7);
      expect(view.host.textContent).not.toContain('ready to cut');
    } finally {
      await view.unmount();
    }
  });

  it('connects only after using the selected controller and baud', async () => {
    const originalConnect = useLaserStore.getState().connect;
    const connect = vi.fn(async () => undefined);
    useLaserStore.setState({ connect });
    const view = await renderWizard();
    try {
      await changeSelect(view.host, 'Controller firmware', 'marlin');
      await act(async () => button(view.host, 'Next').click());
      await act(async () => {
        button(view.host, 'Connect…').click();
        await Promise.resolve();
      });
      expect(connect).toHaveBeenCalledWith(expect.anything(), {
        controllerKind: 'marlin',
        baudRate: 250000,
      });
    } finally {
      await view.unmount();
      useLaserStore.setState({ connect: originalConnect });
    }
  });

  it('keeps detected identity observational until the operator explicitly adopts it', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'grblhal',
      detectedSettings: {},
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderWizard();
    try {
      expect(select(view.host, 'Controller firmware').value).toBe('grbl-v1.1');
      await act(async () => button(view.host, 'Next').click());
      expect(view.host.textContent).toContain('Connection does not match the setup draft');
      await act(async () => button(view.host, 'Use detected grblHAL in draft').click());
      await act(async () => button(view.host, 'Back').click());
      expect(select(view.host, 'Controller firmware').value).toBe('grblhal');
    } finally {
      await view.unmount();
    }
  });

  it('disables serial connection when the platform does not support it', async () => {
    const view = await renderWizard(undefined, mockPlatform(false));
    try {
      await act(async () => button(view.host, 'Next').click());
      expect(button(view.host, 'Connect…').disabled).toBe(true);
      expect(view.host.textContent).toContain('Web Serial is unavailable');
    } finally {
      await view.unmount();
    }
  });

  it('keeps all edits in a draft and discards them on cancel', async () => {
    const onClose = vi.fn();
    const view = await renderWizard(onClose);
    try {
      await changeSelect(view.host, 'Controller firmware', 'marlin');
      await act(async () => button(view.host, 'Cancel without saving').click());
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(useStore.getState().project.device.controllerKind).not.toBe('marlin');
      expect(useStore.getState().dirty).toBe(false);
    } finally {
      await view.unmount();
    }
  });

  it('atomically saves a laser profile and workspace at the end', async () => {
    const view = await renderWizard();
    try {
      await act(async () => button(view.host, 'Next').click()); // connect
      await act(async () => button(view.host, 'Next').click()); // workspace
      await changeInput(view.host, 'Device name', 'Beginner laser');
      await changeInput(view.host, 'Bed width (mm)', '510');
      await advanceToReview(view.host);
      expect(view.host.textContent).toContain('Software configuration is internally consistent');
      expect(view.host.textContent).toContain('Hardware commissioning');
      await act(async () => button(view.host, 'Save machine setup').click());

      const store = useStore.getState();
      expect(store.project.device.name).toBe('Beginner laser');
      expect(store.project.device.bedWidth).toBe(510);
      expect(store.project.workspace.width).toBe(510);
      expect(store.undoStack).toHaveLength(1);
    } finally {
      await view.unmount();
    }
  });

  it('keeps a selected catalog profile exact instead of overlaying controller observations', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedControllerKind: 'grblhal',
      detectedSettings: { bedWidth: 363, bedHeight: 273 },
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderWizard();
    try {
      await act(async () => button(view.host, 'Use Creality Falcon A1 Pro').click());
      expect(select(view.host, 'Controller firmware').value).toBe('grblhal');
      await act(async () => button(view.host, 'Next').click());
      await act(async () => button(view.host, 'Next').click());
      expect(input(view.host, 'Bed width (mm)').value).toBe('400');
      expect(useStore.getState().project.device).toEqual(DEFAULT_DEVICE_PROFILE);
    } finally {
      await view.unmount();
    }
  });

  it('shows CNC-only machine settings and commits them with the profile', async () => {
    const view = await renderWizard();
    try {
      const radios = view.host.querySelectorAll('input[name="machine-capability"]');
      const cncRadio = radios.item(1);
      if (!(cncRadio instanceof HTMLInputElement)) throw new Error('CNC radio missing');
      await act(async () => cncRadio.click());
      await changeSelect(view.host, 'Built-in CNC machine', 'genmitsu-3018');
      await act(async () => button(view.host, 'Load into draft').click());
      await act(async () => button(view.host, 'Next').click()); // connect
      await act(async () => button(view.host, 'Next').click()); // workspace
      await act(async () => button(view.host, 'Next').click()); // machine output
      expect(view.host.textContent).toContain('CNC clearance and spindle contract');
      expect(view.host.textContent).not.toContain('Laser output and accessories');
      expect(input(view.host, 'Spindle maximum').value).toBe('10000');
      await changeInput(view.host, 'Safe Z', '9');
      await advanceToReview(view.host);
      await act(async () => button(view.host, 'Save machine setup').click());

      const machine = useStore.getState().project.machine;
      expect(machine?.kind).toBe('cnc');
      if (machine?.kind === 'cnc') expect(machine.params.safeZMm).toBe(9);
      expect(useStore.getState().project.device.bedWidth).toBe(300);
      expect(useStore.getState().project.device.bedHeight).toBe(180);
      expect(useStore.getState().project.device.capabilities).toContain('cnc-output');
      expect(useStore.getState().project.device.capabilities).not.toContain('laser-output');
      expect(useStore.getState().project.device.cncSubProfile?.safeZMm).toBe(9);
      expect(useStore.getState().cachedCncMachine?.params.safeZMm).toBe(9);
    } finally {
      await view.unmount();
    }
  });

  it('saves a hybrid machine with both output contracts and one explicit active mode', async () => {
    const view = await renderWizard();
    try {
      const hybridRadio = view.host.querySelectorAll('input[name="machine-capability"]').item(2);
      if (!(hybridRadio instanceof HTMLInputElement)) throw new Error('hybrid radio missing');
      await act(async () => hybridRadio.click());
      expect(view.host.textContent).toContain('Active mode after Save');
      expect(view.host.textContent).toContain('interchangeable laser and spindle toolheads');

      await act(async () => button(view.host, 'Next').click()); // connect
      await act(async () => button(view.host, 'Next').click()); // workspace
      await act(async () => button(view.host, 'Next').click()); // machine output
      expect(view.host.textContent).toContain('Laser output and accessories');
      expect(view.host.textContent).toContain('CNC clearance and spindle contract');
      await changeInput(view.host, 'Safe Z', '10');
      await advanceToReview(view.host);
      await act(async () => button(view.host, 'Save machine setup').click());

      const state = useStore.getState();
      expect(state.project.machine?.kind).toBe('laser');
      expect(state.project.device.capabilities).toEqual(
        expect.arrayContaining(['laser-output', 'cnc-output']),
      );
      expect(state.project.device.cncSubProfile?.safeZMm).toBe(10);
      expect(state.cachedCncMachine?.params.safeZMm).toBe(10);
    } finally {
      await view.unmount();
    }
  });

  it('blocks a controller that cannot run the selected CNC output contract', async () => {
    const view = await renderWizard();
    try {
      const cncRadio = view.host.querySelectorAll('input[name="machine-capability"]').item(1);
      if (!(cncRadio instanceof HTMLInputElement)) throw new Error('CNC radio missing');
      await act(async () => cncRadio.click());
      await changeSelect(view.host, 'Controller firmware', 'marlin');
      expect(view.host.textContent).toContain('not a KerfDesk CNC streaming target');
      expect(button(view.host, 'Next').disabled).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it('lets the operator apply detected values without mutating the project early', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedSettings: { bedWidth: 363, bedHeight: 273 },
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderWizard();
    try {
      await act(async () => button(view.host, 'Next').click());
      await act(async () => button(view.host, 'Use detected values').click());
      await act(async () => button(view.host, 'Next').click());
      expect(input(view.host, 'Bed width (mm)').value).toBe('363');
      expect(useStore.getState().project.device.bedWidth).toBe(DEFAULT_DEVICE_PROFILE.bedWidth);
    } finally {
      await view.unmount();
    }
  });

  it('uses external configuration guidance for Marlin instead of firmware writes', async () => {
    const view = await renderWizard();
    try {
      await changeSelect(view.host, 'Controller firmware', 'marlin');
      await advanceToFirmware(view.host);
      expect(view.host.textContent).toContain('Marlin configuration is not written from KerfDesk');
      expect(view.host.textContent).toContain('M503, M114, M400');
      expect(view.host.textContent).not.toContain('Write and verify');
    } finally {
      await view.unmount();
    }
  });

  it('hides serial streaming and G-code controls for file-only Ruida setup', async () => {
    const view = await renderWizard();
    try {
      await changeSelect(view.host, 'Controller firmware', 'ruida');
      expect(view.host.textContent).toContain('File export');
      expect(view.host.querySelector('[aria-label="Serial baud rate"]')).toBeNull();
      expect(view.host.querySelector('[aria-label="G-code output dialect"]')).toBeNull();
      expect(view.host.querySelector('[aria-label="Streaming mode"]')).toBeNull();
      await act(async () => button(view.host, 'Next').click());
      expect(view.host.textContent).toContain('No live connection is used for this controller');
    } finally {
      await view.unmount();
    }
  });

  it('queues only confirmed common GRBL writes for final Save and keeps travel review-only', async () => {
    const originalWrite = useLaserStore.getState().writeGrblSetting;
    const writeGrblSetting = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'grbl-v1.1',
      statusReport: IDLE_STATUS,
      grblSettingsRows: settingsMapToRows(
        new Map([
          [30, '900'],
          [130, '350'],
        ]),
      ),
      lastSettingsReadAt: Date.now(),
      writeGrblSetting,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderWizard();
    try {
      await advanceToFirmware(view.host);
      expect(view.host.textContent).toContain('Queue $30 for Save');
      expect(view.host.textContent).toContain('$130');
      expect(view.host.textContent).toContain('never batch-written');
      expect(view.host.textContent).not.toContain('Queue $130 for Save');
      const queue = button(view.host, 'Queue $30 for Save');
      expect(queue.disabled).toBe(true);
      const backup = input(view.host, 'Confirm controller backup exported');
      await act(async () => {
        backup.checked = true;
        Simulate.change(backup);
      });
      const confirm = input(view.host, 'Confirm write $30');
      await act(async () => {
        confirm.checked = true;
        Simulate.change(confirm);
      });
      expect(queue.disabled).toBe(false);
      await act(async () => {
        queue.click();
        await Promise.resolve();
      });
      expect(writeGrblSetting).not.toHaveBeenCalled();
      expect(view.host.textContent).toContain('Remove queued $30');
      await act(async () => button(view.host, 'Next').click());
      expect(view.host.textContent).toContain('Firmware after save');
      expect(view.host.textContent).toContain('$30=1000; exact re-read required');
      await act(async () => {
        button(view.host, 'Save setup and write 1 setting').click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(writeGrblSetting).toHaveBeenCalledWith(30, '1000');
    } finally {
      await view.unmount();
      useLaserStore.setState({ writeGrblSetting: originalWrite });
    }
  });
});

async function advanceToFirmware(host: HTMLElement): Promise<void> {
  while (!host.textContent?.includes('Step 6 of 7 — Firmware review')) {
    await act(async () => button(host, 'Next').click());
  }
}

async function advanceToReview(host: HTMLElement): Promise<void> {
  while (!host.textContent?.includes('Step 7 of 7 — Review & hardware handoff')) {
    await act(async () => button(host, 'Next').click());
  }
}

async function changeSelect(host: HTMLElement, ariaLabel: string, value: string): Promise<void> {
  const field = select(host, ariaLabel);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

function select(host: HTMLElement, ariaLabel: string): HTMLSelectElement {
  const field = host.querySelector(`select[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLSelectElement)) throw new Error(`Select missing: ${ariaLabel}`);
  return field;
}

async function changeInput(host: HTMLElement, ariaLabel: string, value: string): Promise<void> {
  const field = input(host, ariaLabel);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
}

function input(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const field = host.querySelector(`input[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLInputElement)) throw new Error(`Input missing: ${ariaLabel}`);
  return field;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
