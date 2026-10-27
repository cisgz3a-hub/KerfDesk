// Rolling audit v4 H1-P3-1 and H1-P3-3: the Save dialog and the Inspector's
// views of the current canvas compile through their real context builder, and
// get the S words Start streams when the connected $30 differs from the profile.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveGcodeContext } from '../commands/gcode-command-actions';
import { projectInspectionContext } from '../gcode-inspector/gcode-inspection-source';
import { installFrameOnceProject } from '../laser/frame-once.test-support';
import { prepareCurrentStartJob } from '../laser/start-job-source';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { handleInspectCurrentGcode } from './inspect-current-gcode-action';
import { currentSaveGcodeContext } from './save-gcode-context';
import { emitSaveGcode } from './save-gcode-emission';

const PROFILE_MAX_S = 1000;
const CONTROLLER_MAX_S = 255;

beforeEach(() => {
  installFrameOnceProject();
  const { project } = useStore.getState();
  useStore.setState({
    project: { ...project, device: { ...project.device, maxPowerS: PROFILE_MAX_S } },
  });
  useLaserStore.setState((state) => ({
    activeControllerKind: 'grbl-v1.1',
    controllerSettings: { ...state.controllerSettings, maxPowerS: CONTROLLER_MAX_S },
    controllerSettingsObservation: { sessionEpoch: state.controllerSessionEpoch, observedAt: 1 },
  }));
});

afterEach(() => {
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
});

function powerWords(gcode: string): ReadonlyArray<number> {
  const words = gcode
    .split('\n')
    .flatMap((line) => [...(line.split(';')[0] ?? '').matchAll(/S(\d+(?:\.\d+)?)/g)])
    .map((match) => Number(match[1]))
    .filter((power) => power > 0);
  return [...new Set(words)].sort((a, b) => a - b);
}

async function startPowerWords(): Promise<ReadonlyArray<number>> {
  const prepared = await prepareCurrentStartJob(
    useStore.getState(),
    useLaserStore.getState(),
    useCameraStore.getState(),
    undefined,
    false,
  );
  if (!prepared.ok) throw new Error(`Start refused: ${prepared.messages.join(' ')}`);
  return powerWords(prepared.gcode);
}

describe('Save and the Inspector use the connected $30 as Start does', () => {
  it("compiles the Save dialog's context in the connected range", async () => {
    const start = await startPowerWords();
    expect(Math.max(...start)).toBeLessThanOrEqual(CONTROLLER_MAX_S);

    const saved = await emitSaveGcode(
      currentSaveGcodeContext({
        platform: {} as never,
        app: useStore.getState(),
        laser: useLaserStore.getState(),
        pushToast: vi.fn(),
      }),
      { ok: true },
    );

    expect(saved.kind).toBe('emitted');
    expect(powerWords(saved.gcode)).toEqual(start);
  });

  it('shows the Start S words in the Inspector and shades them against $30', async () => {
    const start = await startPowerWords();
    const opened = vi.fn<(text: string, maxPowerS: number | undefined) => void>();

    const result = await handleInspectCurrentGcode(
      saveGcodeContext({
        platform: {} as never,
        app: useStore.getState(),
        laser: useLaserStore.getState(),
        pushToast: vi.fn(),
        openInspector: vi.fn(),
      }),
      (_name, text, placement, laserMaxPowerS) => {
        const context = projectInspectionContext(
          useStore.getState().project,
          placement,
          laserMaxPowerS,
        );
        opened(text, context.machineKind === 'laser' ? context.laser.maxPowerS : undefined);
      },
    );

    expect(result).toEqual({ kind: 'ready' });
    const [text, shadingMaxS] = opened.mock.calls[0] ?? [];
    expect(powerWords(text ?? '')).toEqual(start);
    expect(shadingMaxS).toBe(CONTROLLER_MAX_S);
  });

  it('keeps the profile range once the controller is disconnected', async () => {
    useLaserStore.setState({ connection: { kind: 'disconnected' } });
    const opened = vi.fn<(maxPowerS: number | undefined) => void>();

    await handleInspectCurrentGcode(
      saveGcodeContext({
        platform: {} as never,
        app: useStore.getState(),
        laser: useLaserStore.getState(),
        pushToast: vi.fn(),
        openInspector: vi.fn(),
      }),
      (_name, _text, placement, laserMaxPowerS) => {
        const context = projectInspectionContext(
          useStore.getState().project,
          placement,
          laserMaxPowerS,
        );
        opened(context.machineKind === 'laser' ? context.laser.maxPowerS : undefined);
      },
    );

    expect(opened).toHaveBeenCalledWith(PROFILE_MAX_S);
  });
});
