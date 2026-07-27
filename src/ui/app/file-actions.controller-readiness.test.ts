// Rule 7 / ADR-228: controller-setting policy ($30 / $32) is operator
// information, never a refusal. Save and export are named verbatim in the
// guard definition, so a reported $30 mismatch must EXPORT THE FILE and state
// the mismatch — the same fact Start already puts in the Job Review warnings
// list (start-job-controller-policy.ts routes the identical strings there).
//
// This path previously ran a confirm() that aborted the save on "cancel", and
// returned false without asking at all while a job was streaming.

import { describe, expect, it, vi } from 'vitest';

import type { ControllerSettingsSnapshot } from '../../core/preflight';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { FileHandle, PlatformAdapter, SaveTarget } from '../../platform/types';
import { handleSaveGcode } from './file-actions';

const CONTROLLER_MAX_POWER_S = 255;

function mockPlatform(save: () => Promise<SaveTarget | null>): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async (): Promise<ReadonlyArray<FileHandle>> => [],
    pickFileForSave: save,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

function lineProject(): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line-1',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

// $30 disagrees with the project's max S, and $32 is on so laser mode is
// proven good — isolates the mismatch as the only readiness finding.
const MISMATCHED_CONTROLLER: ControllerSettingsSnapshot = {
  maxPowerS: CONTROLLER_MAX_POWER_S,
  laserModeEnabled: true,
};

describe('handleSaveGcode controller-readiness policy', () => {
  it('exports the file and warns when the connected controller $30 disagrees', async () => {
    const project = lineProject();
    const written: string[] = [];
    const target: SaveTarget = {
      displayName: 'job.gcode',
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('expected text G-code');
        written.push(data);
      },
    };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);
    const messages: Array<{ readonly message: string; readonly variant?: string }> = [];

    await handleSaveGcode({
      platform: mockPlatform(async () => target),
      project,
      savedName: null,
      controllerSettings: MISMATCHED_CONTROLLER,
      pushToast: (message, variant) => {
        messages.push(variant === undefined ? { message } : { message, variant });
      },
    });

    // No confirmation gate may stand between the operator and an export.
    expect(confirm).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(written).toHaveLength(1);
    // The same fact the Start path states, in the same words.
    expect(
      messages.some(
        (m) =>
          m.variant === 'warning' &&
          m.message.includes(
            `Controller $30 is ${CONTROLLER_MAX_POWER_S} but this project is set to max S ${project.device.maxPowerS}. Apply the detected setting before starting.`,
          ),
      ),
    ).toBe(true);
    vi.restoreAllMocks();
  });

  // The refusal this replaced was raised on every save ATTEMPT, before the
  // picker. Reporting only after a successful write would tell the operator
  // LESS than the refusal did, which the demotion is not allowed to do.
  it('still states the mismatch when the operator cancels the file picker', async () => {
    const project = lineProject();
    const messages: Array<{ readonly message: string; readonly variant?: string }> = [];

    await handleSaveGcode({
      platform: mockPlatform(async () => null),
      project,
      savedName: null,
      controllerSettings: MISMATCHED_CONTROLLER,
      pushToast: (message, variant) => {
        messages.push(variant === undefined ? { message } : { message, variant });
      },
    });

    expect(
      messages.some(
        (m) =>
          m.variant === 'warning' &&
          m.message.includes(`Controller $30 is ${CONTROLLER_MAX_POWER_S}`),
      ),
    ).toBe(true);
  });

  it('raises no readiness warning when the controller agrees', async () => {
    const project = lineProject();
    const messages: string[] = [];

    await handleSaveGcode({
      platform: mockPlatform(async () => null),
      project,
      savedName: null,
      controllerSettings: { maxPowerS: project.device.maxPowerS, laserModeEnabled: true },
      pushToast: (message) => messages.push(message),
    });

    expect(messages.some((message) => message.includes('connected controller'))).toBe(false);
  });
});
