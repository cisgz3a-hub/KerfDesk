// ADR-416 Amendment 2 (controller meta audit M4-P1-1): a running or held job
// keeps the machine it started with, whichever command writes it. Before this,
// Undo during a CNC bit change could turn the project back to Laser, and the
// next point move lost its safe-Z lift.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStreamer, type StreamerState } from '../../core/controllers/grbl';
import { SCULPFUN_S30_PROFILE } from '../../core/devices/brand-laser-profiles';
import { createProject, LASER_MACHINE_CONFIG, machineKindOf } from '../../core/scene';
import {
  JOB_MACHINE_CHANGE_REFUSED,
  JOB_MACHINE_OPEN_REFUSED,
  JOB_MACHINE_REDO_REFUSED,
  JOB_MACHINE_UNDO_REFUSED,
  sameJobMachine,
} from './job-machine-lock';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { undoSteps } from './undo-history';

beforeEach(() => {
  resetStore();
  clearToasts();
});

afterEach(() => {
  useLaserStore.setState({ streamer: null });
  clearToasts();
  resetStore();
});

/** A two-bit CNC job held at its tool change (M0). */
function holdJob(status: StreamerState['status'] = 'tool-change'): void {
  useLaserStore.setState({
    streamer: { ...createStreamer('G0 Z5\nM0\nG0 Z5\n'), status, inFlight: [] },
  });
}

function endJob(): void {
  useLaserStore.setState({
    streamer: { ...createStreamer('G0 Z5\n'), status: 'cancelled', inFlight: [] },
  });
}

function kind(): string {
  return machineKindOf(useStore.getState().project.machine);
}

async function lastToast(): Promise<string | undefined> {
  await Promise.resolve();
  return useToastStore.getState().toasts.at(-1)?.message;
}

function clearToasts(): void {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
}

describe('Undo and Redo while a job holds the machine', () => {
  it('keeps a CNC job held at a bit change in CNC when Undo would turn it back to Laser', async () => {
    useStore.getState().setMachineKind('cnc');
    holdJob();
    const { project, undoStack, redoStack } = useStore.getState();

    useStore.getState().undo();

    expect(kind()).toBe('cnc');
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toBe(undoStack);
    expect(useStore.getState().redoStack).toBe(redoStack);
    expect(await lastToast()).toBe(JOB_MACHINE_UNDO_REFUSED);
  });

  it.each(['streaming', 'paused', 'done', 'errored'] as const)(
    'refuses the same Undo while the job is %s',
    (status) => {
      useStore.getState().setMachineKind('cnc');
      holdJob(status);
      useStore.getState().undo();
      expect(kind()).toBe('cnc');
    },
  );

  it('keeps a CNC job in CNC when Redo would replay a switch to Laser', async () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().setMachineKind('laser');
    useStore.getState().undo();
    expect(kind()).toBe('cnc');
    holdJob();
    const { redoStack } = useStore.getState();

    useStore.getState().redo();

    expect(kind()).toBe('cnc');
    expect(useStore.getState().redoStack).toBe(redoStack);
    expect(await lastToast()).toBe(JOB_MACHINE_REDO_REFUSED);
  });

  it('refuses a step that changes only the CNC safe height', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({ params: { safeZMm: 12 } });
    holdJob();

    useStore.getState().undo();

    const machine = useStore.getState().project.machine;
    expect(machine?.kind === 'cnc' ? machine.params.safeZMm : null).toBe(12);
  });

  it('still undoes and redoes steps that leave the machine alone', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateDeviceProfile({ name: 'Shop router' });
    holdJob();

    useStore.getState().undo();
    expect(useStore.getState().project.device.name).not.toBe('Shop router');
    expect(kind()).toBe('cnc');

    useStore.getState().redo();
    expect(useStore.getState().project.device.name).toBe('Shop router');
  });

  it('stops an Undo History jump at the step that changes the machine', async () => {
    useStore.getState().setMachineKind('cnc');
    const depth = useStore.getState().undoStack.length;
    useStore.getState().updateDeviceProfile({ name: 'A' });
    useStore.getState().updateDeviceProfile({ name: 'B' });
    holdJob();

    undoSteps(3);

    expect(kind()).toBe('cnc');
    expect(useStore.getState().undoStack).toHaveLength(depth);
    expect(useStore.getState().redoStack).toHaveLength(2);
    expect(await lastToast()).toBe(JOB_MACHINE_UNDO_REFUSED);
  });

  it('applies the same Undo once the job has ended', () => {
    useStore.getState().setMachineKind('cnc');
    holdJob();
    useStore.getState().undo();
    expect(kind()).toBe('cnc');

    endJob();
    useStore.getState().undo();

    expect(kind()).toBe('laser');
  });
});

describe('Other writers while a job holds the machine', () => {
  it('refuses the Laser/CNC switch action itself, not only its toolbar button', async () => {
    useStore.getState().setMachineKind('cnc');
    holdJob();
    const { undoStack } = useStore.getState();

    useStore.getState().setMachineKind('laser');

    expect(kind()).toBe('cnc');
    expect(useStore.getState().undoStack).toBe(undoStack);
    expect(await lastToast()).toBe(JOB_MACHINE_CHANGE_REFUSED);
  });

  it('refuses a Machine Setup save that reaches the store (ADR-416 Amendment 1)', () => {
    useStore.getState().setMachineKind('cnc');
    holdJob();
    const { project, undoStack } = useStore.getState();

    useStore.getState().replaceMachineSetup(SCULPFUN_S30_PROFILE, LASER_MACHINE_CONFIG);

    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toBe(undoStack);
  });

  it('opens no project on another machine, and says why', async () => {
    useStore.getState().setMachineKind('cnc');
    holdJob();
    const { project, projectDocumentEpoch } = useStore.getState();

    const result = useStore.getState().setProject(createProject());

    expect(result).toEqual({ kind: 'job-machine-locked' });
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().projectDocumentEpoch).toBe(projectDocumentEpoch);
    expect(await lastToast()).toBe(JOB_MACHINE_OPEN_REFUSED);
  });

  it('opens a project on the same machine', () => {
    useStore.getState().setMachineKind('cnc');
    const current = useStore.getState().project;
    holdJob();

    // A file saved on this machine: the same device and CNC setup, other artwork.
    const result = useStore.getState().setProject({ ...current, scene: createProject().scene });

    expect(result.kind).not.toBe('job-machine-locked');
    expect(useStore.getState().project).not.toBe(current);
    expect(kind()).toBe('cnc');
  });
});

describe('sameJobMachine', () => {
  it('compares the motion fields by value, not by object', () => {
    const project = createProject();
    const rebuilt = {
      ...project,
      device: { ...project.device, homing: { ...project.device.homing } },
    };
    expect(sameJobMachine(project, rebuilt)).toBe(true);
    expect(
      sameJobMachine(project, { ...project, device: { ...project.device, name: 'Renamed' } }),
    ).toBe(true);
    expect(
      sameJobMachine(project, {
        ...project,
        device: { ...project.device, bedWidth: project.device.bedWidth + 1 },
      }),
    ).toBe(false);
  });
});
