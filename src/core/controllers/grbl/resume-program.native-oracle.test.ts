// Oracle equivalence for Smoothieware and Marlin laser resume (ADR-364). For
// real KerfDesk emitter output and every restart line, the resumed program must
// burn exactly what the original program burns from that line on: the same
// moves, power, feed, beam mode and air assist. Burns come from the
// upstream-ported power models in src/__fixtures__/controllers, which share no
// code with the resume builder.
//
// The resumed program starts on a controller left in the worst state a
// reconnect can leave it in: the head elsewhere, the beam lit by an operator's
// test fire or a lost stop, the power scale at zero after a Frame, and the feed
// from a framing move. Transform 2, which wrote GRBL power commands for every
// program, is checked against the same oracle to show what the fix changed
// (controller audit recovery-3).

import { describe, expect, it } from 'vitest';
import {
  executeMarlinLine,
  powerUpMarlin,
  runMarlinLines,
  type MarlinBurn,
} from '../../../__fixtures__/controllers/marlin-laser-power-model';
import {
  executeSmoothieLine,
  powerUpSmoothie,
  runSmoothieLines,
  type SmoothieBurn,
} from '../../../__fixtures__/controllers/smoothie-laser-power-model';
import { emitPreparedGcode } from '../../../io/gcode/emit-gcode';
import { prepareOutput } from '../../../io/gcode/prepare-output';
import { profileCatalogEntryById, type DeviceProfile } from '../../devices';
import { normalizeExternalProgram } from '../../external-program';
import type { Project } from '../../scene';
import { buildSmoothieFrameLines, SMOOTHIE_FRAME_TOOL_OFF_LINES } from '../smoothieware/commands';
import { laserResumeDialectForDevice } from './laser-resume-dialect';
import { mixedLaserProject } from './laser-resume-project.test-helper';
import {
  buildResumeProgram,
  LASER_RESUME_TRANSFORM_VERSION,
  type LaserResumeTransformVersion,
} from './resume-program';

const LASER = {
  machineKind: 'laser',
  safeZMm: 0,
  spindleSpinupSec: 0,
  plungeMmPerMin: 300,
} as const;
const RECONNECTED_HEAD = { x: 987.654, y: 876.543 };

type Burn = SmoothieBurn | MarlinBurn;

type Scenario = {
  readonly name: string;
  readonly device: () => DeviceProfile;
  /** Every burn of the whole program on a controller that just powered up. */
  readonly original: (gcode: string) => ReadonlyArray<Burn>;
  /** Every burn of a resumed program on a controller left in a hostile state. */
  readonly resumed: (lines: ReadonlyArray<string>) => ReadonlyArray<Burn>;
};

function profile(id: string): DeviceProfile {
  const entry = profileCatalogEntryById(id)?.profile;
  if (entry === undefined) throw new Error(`${id} profile fixture missing`);
  return { ...entry, airAssistCommand: 'M8' };
}

function hostileSmoothie() {
  const model = powerUpSmoothie({ position: RECONNECTED_HEAD });
  // A Frame's tool-off lines zeroed the scale, a framing move set the feed,
  // and then the operator test-fired the beam from the Console.
  runSmoothieLines(model, ['M221 S0 P1', 'G1 F9000', 'fire 10']);
  return model;
}

// The cable dropped mid-burn on a board that does not reset on connect, so the
// beam is still lit, and a framing move left its feed.
function hostileMarlinInline() {
  const model = powerUpMarlin(RECONNECTED_HEAD);
  for (const line of ['M3 I S200', 'G1 F9000']) executeMarlinLine(model, line);
  model.output = 200;
  return model;
}

function hostileMarlinFan() {
  const model = powerUpMarlin(RECONNECTED_HEAD);
  for (const line of ['M106 S255', 'G1 F9000']) executeMarlinLine(model, line);
  return model;
}

const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    name: 'Smoothieware (M221 power scale)',
    device: () => profile('generic-smoothieware'),
    original: (gcode) => runSmoothieLines(powerUpSmoothie(), gcode).burns,
    resumed: (lines) => runSmoothieLines(hostileSmoothie(), lines).burns,
  },
  {
    name: 'Marlin inline (M3 I)',
    device: () => profile('generic-marlin-laser'),
    original: (gcode) => runMarlinLines(powerUpMarlin(), gcode).burns,
    resumed: (lines) => runMarlinLines(hostileMarlinInline(), lines).burns,
  },
  {
    name: 'Marlin fan (M106)',
    device: () => ({
      ...profile('generic-marlin-laser'),
      gcodeDialect: { dialectId: 'marlin-fan' },
    }),
    original: (gcode) => runMarlinLines(powerUpMarlin(), gcode).burns,
    resumed: (lines) => runMarlinLines(hostileMarlinFan(), lines).burns,
  },
];

function emitted(project: Project): string {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight));
  return emitPreparedGcode(prepared).gcode;
}

function burnKey(burn: Burn): string {
  const mode = 'mode' in burn ? burn.mode : burn.source;
  return JSON.stringify([burn.from, burn.to, burn.power, mode, burn.feed, burn.air]);
}

type Divergence = { readonly fromLine: number; readonly detail: string };

function resumeDivergences(
  scenario: Scenario,
  gcode: string,
  transform: LaserResumeTransformVersion,
): { readonly checked: number; readonly divergences: Divergence[] } {
  const original = scenario.original(gcode);
  const laserDialect = laserResumeDialectForDevice(scenario.device());
  const divergences: Divergence[] = [];
  let checked = 0;
  const lineCount = gcode.split('\n').length;
  for (let fromLine = 1; fromLine <= lineCount; fromLine += 1) {
    const resume = buildResumeProgram(gcode, fromLine, {
      ...LASER,
      laserTransform: transform,
      laserDialect,
    });
    if (resume.kind === 'error') {
      if (resume.reason !== 'Nothing left to run from that line.') {
        divergences.push({ fromLine, detail: resume.reason });
      }
      continue;
    }
    checked += 1;
    const expected = original.filter((burn) => burn.line >= fromLine).map(burnKey);
    const actual = scenario.resumed(resume.lines).map(burnKey);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      const index = actual.findIndex((key, at) => key !== expected[at]);
      divergences.push({
        fromLine,
        detail: `${actual.length} burns resumed vs ${expected.length} original; first difference at ${index}: ${actual[index] ?? 'none'} vs ${expected[index] ?? 'none'}`,
      });
    }
  }
  return { checked, divergences };
}

describe.each(SCENARIOS)('laser resume on $name', (scenario) => {
  const gcode = emitted(mixedLaserProject(scenario.device()));

  it('burns what the original burns from every restart line', () => {
    expect(scenario.original(gcode).length).toBeGreaterThan(40);
    const { checked, divergences } = resumeDivergences(scenario, gcode, 3);
    expect(checked).toBeGreaterThan(150);
    expect(divergences.slice(0, 3)).toEqual([]);
  }, 60_000);

  it('burns what a resumed program burns, when that program is resumed again', () => {
    // A recovery of a recovery resumes the resumed program's own text.
    const middle = scenario.original(gcode)[40]?.line ?? 0;
    const first = buildResumeProgram(gcode, middle, {
      ...LASER,
      laserDialect: laserResumeDialectForDevice(scenario.device()),
    });
    if (first.kind === 'error') throw new Error(first.reason);
    const resumed = first.lines.join('\n');
    const { checked, divergences } = resumeDivergences(scenario, resumed, 3);
    expect(checked).toBeGreaterThan(50);
    expect(divergences.slice(0, 3)).toEqual([]);
  }, 60_000);

  it('diverged from the original under transform 2 (controller audit recovery-3)', () => {
    const { checked, divergences } = resumeDivergences(scenario, gcode, 2);
    expect(divergences.length).toBeGreaterThan(checked / 2);
  }, 60_000);
});

// An opened program on Smoothieware (controller audit v2 C6-P2-1) sets its
// power only with S and never sends M221, so it burns at whatever scale the
// board holds, and a Frame's tool-off lines leave that at zero. The baseline's
// `M221 S100` (ADR-630 Amendment 3) sets it, and a resume scanning past the
// baseline re-arms at it.
describe('an opened Smoothieware program after its Frame', () => {
  const file =
    'G00 G17 G40 G21 G54\nG90\nM3\nG0 X0 Y0\nG1 X10 Y0 S0.5 F600\nG1 X10 Y10\nG0 X20\nG1 X30 S0.25\nM5\n';
  const framed = () => {
    const model = powerUpSmoothie({ position: RECONNECTED_HEAD });
    const frame = buildSmoothieFrameLines({ minX: 0, minY: 0, maxX: 30, maxY: 10 }, 3000);
    runSmoothieLines(model, [
      ...SMOOTHIE_FRAME_TOOL_OFF_LINES,
      ...frame.map((line) => line.trim()),
    ]);
    expect(model.scale).toBe(0);
    return model;
  };
  const sendable = (baseline?: string) => {
    const normalized = normalizeExternalProgram(file, baseline, 'smoothieware');
    if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('\n'));
    return normalized.program.gcode;
  };
  const scenario: Scenario = {
    name: 'Smoothieware opened program',
    device: () => profile('generic-smoothieware'),
    original: (gcode) => runSmoothieLines(framed(), gcode).burns,
    resumed: (lines) => runSmoothieLines(framed(), lines).burns,
  };

  it('burns its S power at full scale when Started after the Frame', () => {
    expect(scenario.original(sendable()).map((burn) => burn.power)).toEqual([0.5, 0.5, 0.25]);
    // The baseline before ADR-630 Amendment 3 left the Frame's zero scale.
    expect(scenario.original(sendable('G17G21G90G0'))).toEqual([]);
  });

  it('burns what the original burns from every restart line', () => {
    const gcode = sendable();
    const { checked, divergences } = resumeDivergences(
      scenario,
      gcode,
      LASER_RESUME_TRANSFORM_VERSION,
    );
    expect(checked).toBe(gcode.split('\n').length - 1);
    expect(divergences).toEqual([]);
  });
});

describe('the hostile reconnect state is really hostile', () => {
  it('lights the beam on a bare move for every dialect until the resume clears it', () => {
    const smoothie = hostileSmoothie();
    executeSmoothieLine(smoothie, 'G0 X1 Y1');
    expect(smoothie.burns).toMatchObject([{ mode: 'manual' }]);
    const inline = hostileMarlinInline();
    executeMarlinLine(inline, 'G1 X1 Y1');
    expect(inline.burns).toMatchObject([{ source: 'continuous', power: 200 }]);
    const fan = hostileMarlinFan();
    executeMarlinLine(fan, 'G0 X1 Y1');
    expect(fan.burns).toMatchObject([{ source: 'fan', power: 255 }]);
  });
});
