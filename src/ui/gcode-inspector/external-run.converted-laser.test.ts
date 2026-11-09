// Rolling audit v12 X7-P3-3, re-rated P2 (ADR-637 Amendment 11): the G-code
// Inspector's Run streamed a LightBurn-style laser file on a CNC that KerfDesk
// 1.0.29 may have made from a laser, without the question. On that machine
// type the Run review's lit-rapid warning and laser-mode check do not apply,
// so a stock GRBL at `$32=0` burned every rapid. Start now waits for the
// answer, before the Frame and at every later check.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import {
  CONVERTED_LASER_ANSWER_STORAGE_KEY,
  useConvertedLaserAnswerStore,
} from '../state/converted-laser-question';
import { loadLastMachineSelection } from '../state/last-machine-persistence';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { connectWith, makeConnection } from '../state/laser-store-motion-operation.test-support';
import { resolveProjectMachineCapability } from '../state/project-machine-capability';
import { resetStore } from '../state/test-helpers';
import {
  EXTERNAL_ASKS_IF_LASER,
  EXTERNAL_FRAME_FIRST,
  externalStartIssue,
  startExternalProgram,
} from './external-run';

const SAVED_BY_1_0_29 = readFileSync(
  resolve('src/__fixtures__/returning-user/1.0.29-laser-made-cnc-last-machine.json'),
  'utf8',
);
// A LightBurn-shaped laser program: dynamic power, travel between two squares.
const LIGHTBURN_FILE =
  'G21 G90\nM4 S0\nG0 X0 Y0\nG1 X30 F3000 S800\nG1 Y30\nG1 X0\nG1 Y0\nG0 X40 Y0\nG1 X70 S800\nG1 Y30\nG1 X40\nG1 Y0\nM5\n';

function openThe1029Machine(): void {
  const selection = loadLastMachineSelection({
    getItem: () => SAVED_BY_1_0_29,
    setItem: () => undefined,
  });
  if (selection === null) throw new Error('The 1.0.29 last machine did not load');
  useStore.setState({
    project: resolveProjectMachineCapability(
      createProject(selection.profile),
      [],
      selection.machineKind,
    ).project,
  });
}

function resetAnswer(): void {
  useConvertedLaserAnswerStore.setState({ routerAnswered: false });
  localStorage.removeItem(CONVERTED_LASER_ANSWER_STORAGE_KEY);
}

async function connectAndFrame(writes: string[]) {
  const connection = makeConnection(async (data) => {
    writes.push(data);
    if (data === 'G4 P0.01\n') setTimeout(() => connection.emitLine('ok'), 0);
    if (data === '?') {
      setTimeout(() => connection.emitLine('<Idle|MPos:0,0,0|FS:0,0|Ov:100,100,100>'), 0);
    }
  });
  await connectWith(connection);
  // A stock GRBL 1.1 diode: `$30=1000`, laser mode off.
  useLaserStore.setState({
    detectedSettings: { laserModeEnabled: false, maxPowerS: 1000, minPowerS: 0 },
  });
  const verification = { boundsSignature: 'external:laser', wco: null, workOriginActive: false };
  useLaserStore.setState({ frameVerification: verification });
  return {
    run: {
      name: 'lightburn.gcode',
      gcode: LIGHTBURN_FILE,
      envelope: { minX: 0, minY: 0, maxX: 70, maxY: 30 },
      start: { x: 0, y: 0, z: 0 },
    },
    machineKind: 'cnc' as const,
    verification,
    controller: useLaserStore.getState(),
  };
}

beforeEach(() => {
  resetStore();
  resetAnswer();
  openThe1029Machine();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  resetAnswer();
  resetStore();
});

describe('Run on the CNC 1.0.29 may have made from a laser', () => {
  it('asks before the Frame, refuses Start with the question, and sends no program byte', async () => {
    // Before any Frame, the dialog's status already asks.
    expect(externalStartIssue(null)).toBe(EXTERNAL_ASKS_IF_LASER);
    expect(EXTERNAL_ASKS_IF_LASER).toContain('turns the laser on at full power');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const writes: string[] = [];
    const frame = await connectAndFrame(writes);
    expect(externalStartIssue(frame)).toBe(EXTERNAL_ASKS_IF_LASER);
    writes.length = 0;

    await expect(startExternalProgram(frame)).rejects.toThrow(EXTERNAL_ASKS_IF_LASER);
    expect(confirm).not.toHaveBeenCalled();
    expect(writes.join('')).not.toContain('M4');
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('runs once the owner answers that it is a CNC router', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const writes: string[] = [];
    const frame = await connectAndFrame(writes);
    useConvertedLaserAnswerStore.getState().answerRouter();
    expect(externalStartIssue(null)).toBe(EXTERNAL_FRAME_FIRST);
    expect(externalStartIssue(frame)).toBeNull();
    writes.length = 0;

    await expect(startExternalProgram(frame)).resolves.toBe(true);
    expect(writes.join('')).toContain('G1 X30 F3000 S800');
  });
});
