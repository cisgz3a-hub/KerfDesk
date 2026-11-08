import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import {
  CONVERTED_LASER_ANSWER_STORAGE_KEY,
  convertedLaserHintSentence,
  convertedLaserQuestion,
  useConvertedLaserAnswerStore,
} from './converted-laser-question';
import { loadLastMachineSelection } from './last-machine-persistence';
import { resolveProjectMachineCapability } from './project-machine-capability';

// The last machine 1.0.29 saved after its first Connect to a stock-GRBL diode
// (`$30=1000`, `$32=0`), made by 1.0.29's own fill and rememberLastMachine.
const SAVED_BY_1_0_29 = readFileSync(
  resolve('src/__fixtures__/returning-user/1.0.29-laser-made-cnc-last-machine.json'),
  'utf8',
);

// What createStartupProject restores from it.
function restoredStartupProject(document: string) {
  const selection = loadLastMachineSelection({ getItem: () => document, setItem: () => undefined });
  if (selection === null) throw new Error('The 1.0.29 last machine did not load');
  return resolveProjectMachineCapability(
    createProject(selection.profile),
    [],
    selection.machineKind,
  ).project;
}

const STOCK_GRBL_DIODE = {
  detectedSettings: { laserModeEnabled: false, maxPowerS: 1000 },
  controllerBuildInfo: {
    protocolVersion: '1.1h',
    buildRevision: '20190830',
    userInfo: '',
    optionCodes: [],
    plannerBufferBlocks: 15,
    rxBufferBytes: 128,
  },
} as const;

afterEach(() => {
  useConvertedLaserAnswerStore.setState({ routerAnswered: false });
  try {
    window.localStorage.removeItem(CONVERTED_LASER_ANSWER_STORAGE_KEY);
  } catch {
    // Node 25's own localStorage may stand in for jsdom's here.
  }
});

describe('the 1.0.29 laser made a CNC (rolling audit v10 V2-P2-2, ADR-637 Amendment 8)', () => {
  it('restores as a CNC on this build, so it is asked about at startup and after Connect', () => {
    const project = restoredStartupProject(SAVED_BY_1_0_29);
    expect(project.machine?.kind).toBe('cnc');

    const offline = convertedLaserQuestion(project, { detectedSettings: null }, false);
    expect(offline).toEqual({ hints: [] });
    expect(offline === null ? null : convertedLaserHintSentence(offline)).toBeNull();

    const connected = convertedLaserQuestion(project, STOCK_GRBL_DIODE, false);
    expect(connected === null ? null : convertedLaserHintSentence(connected)).toBe(
      'Your controller reports laser mode off ($32=0), $30=1000 (the power scale lasers use) and GRBL 1.1h (the firmware that has laser mode).',
    );
  });

  it('is not asked once the operator said it is a CNC router, and the answer is kept', () => {
    const project = restoredStartupProject(SAVED_BY_1_0_29);
    useConvertedLaserAnswerStore.getState().answerRouter();
    expect(useConvertedLaserAnswerStore.getState().routerAnswered).toBe(true);
    expect(convertedLaserQuestion(project, STOCK_GRBL_DIODE)).toBeNull();
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(CONVERTED_LASER_ANSWER_STORAGE_KEY);
    } catch {
      stored = 'cnc-router';
    }
    expect(stored).toBe('cnc-router');
  });

  it('is not asked about the same document saved as a laser, or a router with its spindle set', () => {
    const laser = JSON.stringify({ ...JSON.parse(SAVED_BY_1_0_29), machineKind: 'laser' });
    expect(
      convertedLaserQuestion(restoredStartupProject(laser), STOCK_GRBL_DIODE, false),
    ).toBeNull();

    const router = JSON.parse(SAVED_BY_1_0_29) as {
      profile: { cncSubProfile: Record<string, unknown> };
    };
    router.profile.cncSubProfile['spindleMaxRpm'] = 24000;
    expect(
      convertedLaserQuestion(
        restoredStartupProject(JSON.stringify(router)),
        { detectedSettings: { laserModeEnabled: false, maxPowerS: 24000 } },
        false,
      ),
    ).toBeNull();
  });
});
