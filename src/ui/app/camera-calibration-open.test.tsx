import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../core/camera/model/model-fixtures';
import { withSavedCameraModel } from '../../core/camera/model/saved-cameras';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { loadLastMachine } from '../state/last-machine-persistence';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useMachineProfilePersistence } from './use-machine-profile-persistence';

// ADR-440 Amendment 3: the camera calibration belongs to the machine, so a
// saved calibration survives a restart and opening a project file.

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
function Probe(): null {
  useMachineProfilePersistence();
  return null;
}

beforeEach(async () => {
  localStorage.clear();
  resetStore();
  useToastStore.setState({ toasts: [] });
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  localStorage.clear();
  resetStore();
});

const latest = { ...savedCameraModel(), calibratedAt: '2026-10-25T12:00:00.000Z' };
const older = { ...savedCameraModel(), calibratedAt: '2026-09-01T12:00:00.000Z' };

function calibrate(record = latest): void {
  const { device } = useStore.getState().project;
  // What Save calibration does (use-calibration-photo.ts).
  useStore.getState().updateDeviceProfile(withSavedCameraModel(device, record));
}

function toasts(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

describe('a saved camera calibration', () => {
  it('comes back after the app restarts', async () => {
    calibrate();
    vi.resetModules();
    const { useStore: restarted } = await import('../state/store');
    expect(restarted.getState().project.device.cameraModel).toEqual(latest);
  });

  it('stays when a file saved before it is opened, also after the next machine edit', () => {
    const fileFromBefore = createProject(useStore.getState().project.device);
    calibrate();
    expect(useStore.getState().setProject(fileFromBefore).kind).toBe('loaded');
    expect(useStore.getState().project.device.cameraModel).toEqual(latest);
    useStore.getState().updateDeviceProfile({ framingFeedMmPerMin: 1234 });
    expect(loadLastMachine(localStorage)?.cameraModel).toEqual(latest);
    expect(toasts().some((message) => message.includes('camera calibration'))).toBe(false);
  });

  it('is not replaced by an older calibration saved in the file, and says so', () => {
    calibrate(older);
    const fileWithOlder = createProject(useStore.getState().project.device);
    calibrate(latest);
    useStore.getState().setProject(fileWithOlder);
    expect(useStore.getState().project.device.cameraModel).toEqual(latest);
    expect(toasts()).toContain(
      "This file's camera calibration was not used: the camera keeps your machine's current calibration.",
    );
  });

  it('opens a file holding the same calibration without a message', () => {
    calibrate();
    const sameCopy = JSON.parse(JSON.stringify(useStore.getState().project)) as ReturnType<
      typeof createProject
    >;
    useStore.getState().setProject(sameCopy);
    expect(useStore.getState().project.device.cameraModel).toEqual(latest);
    expect(toasts().some((message) => message.includes('camera calibration'))).toBe(false);
  });

  it("comes from the file when this machine has none, and with another machine's file", () => {
    const device = useStore.getState().project.device;
    const withOlder = { ...device, ...withSavedCameraModel(device, older) };
    useStore.getState().setProject(createProject(withOlder));
    expect(useStore.getState().project.device.cameraModel).toEqual(older);

    calibrate(latest);
    const otherMachine = { ...withOlder, name: 'Workshop laser' };
    useStore.getState().setProject(createProject(otherMachine));
    expect(useStore.getState().projectBedReconciliation?.machineChanged).toBe(true);
    expect(useStore.getState().project.device.cameraModel).toEqual(older);
  });
});
