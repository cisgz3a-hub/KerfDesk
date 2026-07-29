import { describe, expect, it } from 'vitest';

import { mockPlatform, projectWithLine, toasts } from '../../__fixtures__/file-actions';
import type { SaveTarget } from '../../platform/types';
import { handleSaveGcode } from './file-actions';

const MISMATCHED_MAX_POWER_S = 255;

function controllerMismatchToast(projectMaxPowerS: number): string {
  return `Controller $30 is ${MISMATCHED_MAX_POWER_S} but this project is set to max S ${projectMaxPowerS}`;
}

describe('handleSaveGcode controller readiness advisories', () => {
  it('exports and states a known $30 mismatch', async () => {
    const project = projectWithLine();
    const written: string[] = [];
    const target: SaveTarget = {
      displayName: 'job.gcode',
      write: async (data) => {
        written.push(String(data));
      },
    };
    const toast = toasts();
    await handleSaveGcode({
      platform: mockPlatform({ save: async () => target }),
      project,
      savedName: null,
      controllerSettings: { maxPowerS: MISMATCHED_MAX_POWER_S, laserModeEnabled: true },
      pushToast: toast.pushToast,
    });

    expect(written).toHaveLength(1);
    expect(toast.messages).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining(controllerMismatchToast(project.device.maxPowerS)),
        variant: 'warning',
      }),
    );
  });

  it('states a known $30 mismatch when the picker is cancelled', async () => {
    const project = projectWithLine();
    const toast = toasts();
    await handleSaveGcode({
      platform: mockPlatform(),
      project,
      savedName: null,
      controllerSettings: { maxPowerS: MISMATCHED_MAX_POWER_S, laserModeEnabled: true },
      pushToast: toast.pushToast,
    });

    expect(toast.messages).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining(controllerMismatchToast(project.device.maxPowerS)),
        variant: 'warning',
      }),
    );
  });

  it('does not state an advisory when the controller agrees', async () => {
    const project = projectWithLine();
    const toast = toasts();
    await handleSaveGcode({
      platform: mockPlatform(),
      project,
      savedName: null,
      controllerSettings: { maxPowerS: project.device.maxPowerS, laserModeEnabled: true },
      pushToast: toast.pushToast,
    });

    expect(toast.messages).toHaveLength(0);
  });
});
