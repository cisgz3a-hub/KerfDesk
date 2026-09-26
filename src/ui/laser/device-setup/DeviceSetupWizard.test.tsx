import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../../core/controllers/grbl';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { mockPlatform, renderWizard } from './device-setup-wizard.test-support';
import {
  changeSetupInput as changeInput,
  changeSetupSelect as changeSelect,
  openSetupDisclosure,
  setupInput as input,
  setupSelect as select,
} from './device-setup-test-helpers';

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

// The three-stage shell and searchable-catalog behavior are pinned in
// DeviceSetupWizard.catalog.test.tsx.
describe('DeviceSetupWizard', () => {
  it('defaults worker streaming on for GRBL-family controllers and keeps an explicit opt-out', async () => {
    const view = await renderWizard();
    const workerOption = () =>
      view.host.querySelector<HTMLInputElement>(
        'input[aria-label="Read the serial port and refill the job stream in a worker"]',
      );
    try {
      await openSetupDisclosure(view.host, 'Connection options');
      await openSetupDisclosure(view.host, 'Advanced connection and streaming');
      const option = workerOption();
      if (option === null) throw new Error('GRBL worker option missing');
      // ADR-354: on by default for a GRBL-family profile with no saved choice.
      expect(option.checked).toBe(true);
      await act(async () => option.click());
      expect(workerOption()?.checked).toBe(false);

      for (const controllerKind of ['marlin', 'smoothieware']) {
        await changeSelect(view.host, 'Controller firmware', controllerKind);
        expect(workerOption()).toBeNull();
      }
      for (const controllerKind of ['grblhal', 'fluidnc', 'grbl-v1.1']) {
        await changeSelect(view.host, 'Controller firmware', controllerKind);
        // The explicit opt-out survives a controller change.
        expect(workerOption()?.checked).toBe(false);
      }
    } finally {
      await view.unmount();
    }
  });

  it.each(['laser', 'cnc'] as const)(
    'reaches Save in two advances for %s without connecting',
    async (kind) => {
      const originalConnect = useLaserStore.getState().connect;
      const connect = vi.fn(async () => undefined);
      useLaserStore.setState({ connect });
      const view = await renderWizard(undefined, mockPlatform(false));
      try {
        if (kind === 'cnc') {
          const cnc = view.host.querySelectorAll('input[name="machine-capability"]').item(1);
          if (!(cnc instanceof HTMLInputElement)) throw new Error('CNC radio missing');
          await act(async () => cnc.click());
        }
        await act(async () => button(view.host, 'Check essentials').click());
        expect(view.host.textContent).toContain('Step 2 of 3');
        await act(async () => button(view.host, 'Review setup').click());
        expect(view.host.textContent).toContain('Step 3 of 3');
        expect(
          button(view.host, kind === 'cnc' ? 'Save CNC machine setup' : 'Save machine setup')
            .disabled,
        ).toBe(false);
        expect(connect).not.toHaveBeenCalled();
      } finally {
        await view.unmount();
        useLaserStore.setState({ connect: originalConnect });
      }
    },
  );

  it('connects only after using the selected controller and baud', async () => {
    const originalConnect = useLaserStore.getState().connect;
    const connect = vi.fn(async () => undefined);
    useLaserStore.setState({ connect });
    const view = await renderWizard();
    try {
      await openSetupDisclosure(view.host, 'Connection options');
      await changeSelect(view.host, 'Controller firmware', 'marlin');
      await act(async () => {
        button(view.host, 'Find my machine').click();
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
      await openSetupDisclosure(view.host, 'Connection options');
      expect(select(view.host, 'Controller firmware').value).toBe('grbl-v1.1');
      expect(view.host.textContent).toContain('The connection does not match this setup');
      await act(async () => button(view.host, 'Use detected grblHAL in draft').click());
      expect(select(view.host, 'Controller firmware').value).toBe('grblhal');
    } finally {
      await view.unmount();
    }
  });

  it('disables serial connection when the platform does not support it', async () => {
    const view = await renderWizard(undefined, mockPlatform(false));
    try {
      expect(buttonOrNull(view.host, 'Find my machine')).toBeNull();
      expect(view.host.textContent).toContain('This browser can’t reach USB machines');
    } finally {
      await view.unmount();
    }
  });

  it('keeps all edits in a draft and discards them on cancel', async () => {
    const onClose = vi.fn();
    const view = await renderWizard(onClose);
    try {
      await openSetupDisclosure(view.host, 'Connection options');
      await changeSelect(view.host, 'Controller firmware', 'marlin');
      await act(async () => button(view.host, 'Cancel without saving').click());
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(useStore.getState().project.device.controllerKind).not.toBe('marlin');
      expect(useStore.getState().dirty).toBe(false);
    } finally {
      await view.unmount();
    }
  });

  it('lets an invalid work area reach Essentials and enables Save only after correction', async () => {
    const before = useStore.getState();
    useStore.setState({
      project: {
        ...before.project,
        device: { ...before.project.device, bedWidth: 0 },
      },
    });
    const view = await renderWizard();
    try {
      expect(button(view.host, 'Check essentials').disabled).toBe(false);
      await act(async () => button(view.host, 'Check essentials').click());
      expect(input(view.host, 'Bed width (mm)').value).toBe('0');
      expect(button(view.host, 'Review setup').disabled).toBe(false);
      await act(async () => button(view.host, 'Review setup').click());
      expect(button(view.host, 'Save machine setup').disabled).toBe(true);
      await act(async () => button(view.host, 'Back').click());
      await changeInput(view.host, 'Bed width (mm)', '510');
      await act(async () => button(view.host, 'Review setup').click());
      expect(button(view.host, 'Save machine setup').disabled).toBe(false);
      expect(useStore.getState().project.device.bedWidth).toBe(0);
    } finally {
      await view.unmount();
    }
  });

  it('atomically saves a laser profile and workspace at the end', async () => {
    const view = await renderWizard();
    try {
      await act(async () => button(view.host, 'Check essentials').click());
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

  it('shows CNC-only machine settings and commits them with the profile', async () => {
    const view = await renderWizard();
    try {
      const radios = view.host.querySelectorAll('input[name="machine-capability"]');
      const cncRadio = radios.item(1);
      if (!(cncRadio instanceof HTMLInputElement)) throw new Error('CNC radio missing');
      await act(async () => cncRadio.click());
      await changeSelect(view.host, 'Built-in CNC machine', 'genmitsu-3018');
      await act(async () => button(view.host, 'Load into draft').click());
      await act(async () => button(view.host, 'Check essentials').click());
      expect(view.host.textContent).toContain('CNC machine limits');
      expect(view.host.textContent).toContain('assumes an installed, powered Z axis');
      expect(view.host.textContent).toContain('Recorded Z travel is informational');
      expect(view.host.querySelector('input[aria-label="GRBL $30 max power S"]')).toBeNull();
      expect(input(view.host, 'Spindle maximum').value).toBe('10000');
      await changeInput(view.host, 'Safe Z', '9');
      await advanceToReview(view.host);
      await act(async () => button(view.host, 'Save CNC machine setup').click());

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
      expect(view.host.querySelectorAll('input[name="active-machine-kind"]')).toHaveLength(2);

      await act(async () => button(view.host, 'Check essentials').click());
      // Hybrid saves with Laser active, retaining both output contracts in Essentials.
      expect(input(view.host, 'GRBL $30 max power S')).toBeInstanceOf(HTMLInputElement);
      expect(view.host.textContent).toContain('CNC machine limits');
      expect(view.host.querySelector('select[aria-label="Project material"]')).toBeNull();
      expect(view.host.querySelectorAll('#machine-setup-cnc-safe-z')).toHaveLength(1);

      await act(async () => button(view.host, 'Back').click());
      const cncMode = view.host.querySelectorAll('input[name="active-machine-kind"]').item(1);
      if (!(cncMode instanceof HTMLInputElement)) throw new Error('Active CNC mode missing');
      await act(async () => cncMode.click());
      await act(async () => button(view.host, 'Check essentials').click());
      await openSetupDisclosure(view.host, 'CNC job setup');
      expect(select(view.host, 'Project material')).toBeInstanceOf(HTMLSelectElement);

      await act(async () => button(view.host, 'Back').click());
      const laserMode = view.host.querySelectorAll('input[name="active-machine-kind"]').item(0);
      if (!(laserMode instanceof HTMLInputElement)) throw new Error('Active Laser mode missing');
      await act(async () => laserMode.click());
      await act(async () => button(view.host, 'Check essentials').click());
      expect(view.host.querySelector('select[aria-label="Project material"]')).toBeNull();
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

  it('allows review of an unsupported CNC controller but keeps invalid setup unsaved', async () => {
    const view = await renderWizard();
    try {
      const cncRadio = view.host.querySelectorAll('input[name="machine-capability"]').item(1);
      if (!(cncRadio instanceof HTMLInputElement)) throw new Error('CNC radio missing');
      await act(async () => cncRadio.click());
      await openSetupDisclosure(view.host, 'Connection options');
      await changeSelect(view.host, 'Controller firmware', 'marlin');
      expect(view.host.textContent).toContain('not a KerfDesk CNC streaming target');
      expect(button(view.host, 'Check essentials').disabled).toBe(false);
      await advanceToReview(view.host);
      expect(button(view.host, 'Save CNC machine setup').disabled).toBe(true);
      expect(view.host.textContent).toContain('cannot run KerfDesk CNC jobs');
    } finally {
      await view.unmount();
    }
  });

  it('uses external configuration guidance for Marlin instead of firmware writes', async () => {
    const view = await renderWizard();
    try {
      await openSetupDisclosure(view.host, 'Connection options');
      await changeSelect(view.host, 'Controller firmware', 'marlin');
      await advanceToReview(view.host);
      await openSetupDisclosure(view.host, 'Controller settings');
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
      await openSetupDisclosure(view.host, 'Connection options');
      await changeSelect(view.host, 'Controller firmware', 'ruida');
      expect(view.host.textContent).toContain('File export');
      expect(view.host.querySelector('[aria-label="Serial baud rate"]')).toBeNull();
      expect(view.host.querySelector('[aria-label="G-code output dialect"]')).toBeNull();
      expect(view.host.querySelector('[aria-label="Streaming mode"]')).toBeNull();
      expect(view.host.textContent).toContain('jobs are saved as files');
      expect(buttonOrNull(view.host, 'Find my machine')).toBeNull();
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
      await advanceToReview(view.host);
      await openSetupDisclosure(view.host, 'Controller settings');
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
      // The review cards share this final page, so the queued write summary
      // sits beside the Save button that will execute it.
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

async function advanceToReview(host: HTMLElement): Promise<void> {
  for (const label of ['Check essentials', 'Review setup']) {
    const next = [...host.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes(label),
    );
    if (next !== undefined) await act(async () => next.click());
  }
  expect(host.textContent).toContain('Step 3 of 3');
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}

function buttonOrNull(host: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === label) ??
    null
  );
}
