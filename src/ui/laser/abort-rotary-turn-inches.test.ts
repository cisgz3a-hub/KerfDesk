// Oracle audit O1 O12-P1-1: with `$13=1`, grblHAL reports an A axis that
// `$376` does not mark as rotary in inches (core report.c), and the Falcon A1
// Pro ships `$376=0`. The turn KerfDesk records at an Abort and the turn it
// reads afterwards must both come back in degrees, or Start from line's
// `G53 G0 A<start>` and the turn-back jog aim 25.4 times too short.
import { describe, expect, it } from 'vitest';
import {
  onResponse,
  startCollecting,
  type ControllerSettingsSnapshot,
} from '../../core/controllers/grbl/parse-settings';
import { reportedTurnScale } from '../../core/controllers/grbl/reported-turn-units';
import { parseStatusReport } from '../../core/controllers/grbl/status-parser';
import { grblDriver } from '../../core/controllers/grbl/driver';
import { currentMachineTurn, rotaryTurnSinceStart } from './abort-rotary-turn';

function settingsFrom(lines: ReadonlyArray<string>): ControllerSettingsSnapshot {
  let state = startCollecting();
  for (const line of [...lines, 'ok']) state = onResponse(state, grblDriver.classifyLine(line));
  if (state.kind !== 'done') throw new Error('settings dump did not complete');
  return state.controllerSettings;
}

// A at machine 254° and Z at 12.7 mm, reported in inches by grblHAL `$13=1`.
const INCH_REPORT = parseStatusReport('<Idle|MPos:0.0000,0.0000,0.5000,10.0000|FS:0,0>');

function turnState(controllerSettings: ControllerSettingsSnapshot) {
  return { statusReport: INCH_REPORT, wcoCache: null, controllerSettings, machineZeroEpoch: 0 };
}

describe('O12-P1-1: a grblHAL A turn reported in inches', () => {
  it('reads grblHAL $376 from the settings dump', () => {
    expect(settingsFrom(['$13=1', '$376=0']).rotaryAxesMask).toBe(0);
    expect(settingsFrom(['$13=1', '$376=8']).rotaryAxesMask).toBe(8);
    expect(settingsFrom(['$13=1']).rotaryAxesMask).toBeUndefined();
  });

  it('turns an inch-reported A back into degrees when $376 leaves A linear', () => {
    const settings = settingsFrom(['$13=1', '$376=0']);
    expect(currentMachineTurn(turnState(settings), 'A')).toBeCloseTo(254, 6);
    // The saved start turn and the turn now share the unit, so the turn since
    // the job started is in degrees too.
    const since = rotaryTurnSinceStart(turnState(settings), {
      axis: 'A',
      machine: 37,
      machineZeroEpoch: 0,
    });
    expect(since).toBeCloseTo(217, 6);
  });

  it('leaves A alone when $376 marks it rotary, when $13=0, or when $376 is not listed', () => {
    expect(currentMachineTurn(turnState(settingsFrom(['$13=1', '$376=8'])), 'A')).toBe(10);
    expect(currentMachineTurn(turnState(settingsFrom(['$13=0', '$376=0'])), 'A')).toBe(10);
    // Stock GRBL and FluidNC never list $376; FluidNC never converts A-C.
    expect(currentMachineTurn(turnState(settingsFrom(['$13=1'])), 'A')).toBe(10);
  });

  it('keeps converting a Z rotary under $13=1, as before', () => {
    expect(currentMachineTurn(turnState(settingsFrom(['$13=1'])), 'Z')).toBeCloseTo(12.7, 6);
    expect(reportedTurnScale({ reportInches: true, rotaryAxesMask: 8 }, 'Z')).toBe(25.4);
  });
});
