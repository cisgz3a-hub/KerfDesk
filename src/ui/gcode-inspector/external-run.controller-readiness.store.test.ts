// An external run checks the controller's $30 and $32 as project Start does
// (ADR-630 Amendment 4; controller audit v3 D4-P2-1, D5-P2-2), through the
// real laser store, a scripted GRBL connection and the real Start.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import { findLitRapids, normalizeExternalProgram } from '../../core/external-program';
import { runControllerReadiness } from '../../core/preflight';
import { CNC_LASER_MODE_ENABLED_MESSAGE } from '../../core/preflight/controller-readiness';
import {
  laserModeDisabledMessage,
  spindleScaleMismatchMessage,
} from '../../core/preflight/controller-readiness-messages';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import { LASER_MODE_UNVERIFIED_START_PROMPT } from '../laser/laser-mode-start-acknowledgement';
import { useStore } from '../state';
import { CNC_SETUP_ATTESTATION_PROMPT } from '../state/cnc-setup-attestation';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { connectWith, makeConnection } from '../state/laser-store-motion-operation.test-support';
import { resetStore } from '../state/test-helpers';
import { startExternalProgram, type ExternalFrame } from './external-run';
import { externalControllerWarnings } from './external-run-readiness';

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';

/** What the controller receives, after connecting with these settings read. */
async function connectReporting(settings: ControllerSettingsSnapshot): Promise<string[]> {
  const writes: string[] = [];
  const connection = makeConnection(async (data) => {
    writes.push(data);
    if (data === 'G4 P0.01\n') setTimeout(() => connection.emitLine('ok'), 0);
    if (data === '?') setTimeout(() => connection.emitLine(IDLE), 0);
  });
  await connectWith(connection);
  const { controllerSessionEpoch } = useLaserStore.getState();
  useLaserStore.setState({
    controllerSettings: settings,
    controllerSettingsObservation: { sessionEpoch: controllerSessionEpoch, observedAt: 1 },
  });
  writes.length = 0;
  return writes;
}

/** The exact bytes Run sends: the baseline line, then the file as GRBL reads it. */
function sent(source: string): string {
  const program = normalizeExternalProgram(source);
  if (program.kind !== 'ok') throw new Error(program.reasons.join('\n'));
  return program.program.gcode;
}

function framed(gcode: string, machineKind: 'laser' | 'cnc'): ExternalFrame {
  const verification = {
    boundsSignature: 'external:readiness',
    wco: null,
    workOriginActive: false,
  };
  useLaserStore.setState({ frameVerification: verification });
  return {
    run: {
      name: 'part.gcode',
      gcode,
      envelope: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
      start: { x: 0, y: 0, z: 0 },
    },
    machineKind,
    verification,
    controller: useLaserStore.getState(),
  };
}

function reviewWarnings(gcode: string): ReadonlyArray<string> {
  return externalControllerWarnings(
    useStore.getState().project,
    useLaserStore.getState(),
    findLitRapids(gcode),
  );
}

// LightBurn-style laser output: power on the cuts, none on the moves between.
const UNGUARDED = sent(
  ['G0 X5 Y5', 'M4', 'G1 X10 Y10 S800 F1000', 'G0 X10 Y40', 'G1 X40 Y40', 'G0 X0 Y0', 'M5'].join(
    '\n',
  ),
);
const GUARDED = sent(
  [
    'G0 X5 Y5 S0',
    'M4',
    'G1 X10 Y10 S800 F1000',
    'G0 X10 Y40 S0',
    'G1 X40 Y40 S800',
    'G0 X0 Y0 S0',
    'M5',
  ].join('\n'),
);
const LIT_RAPIDS =
  'The controller reports $32=0 (laser mode off), so it keeps the beam on during rapid moves. 2 rapid commands in this program run with M3 or M4 on and S not set to 0 (first: line 5 of the sent program): each burns a line where the head travels. Laser mode on, or S0 on those moves, keeps them dark.';

beforeEach(() => {
  resetStore();
  useStore.setState({ project: createProject() });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  resetStore();
});

describe('external run controller readiness (ADR-630 Amendment 4)', () => {
  it('lists a router left in laser mode, as project CNC Start does (D4-P2-1)', async () => {
    const project: Project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
    useStore.setState({ project });
    const writes = await connectReporting({ laserModeEnabled: true, maxPowerS: 1000 });
    const gcode = sent('M3 S11000\nG4 P3\nG0 Z5\nG0 X10 Y10\nG1 Z-2 F300\nG1 X20\nG0 Z5\nM5\n');
    const projectStart = runControllerReadiness(project, {
      laserModeEnabled: true,
      maxPowerS: 1000,
    });
    expect(projectStart.errors.map((issue) => issue.code)).toEqual([
      'spindle-scale-mismatch',
      'laser-mode-enabled',
    ]);
    // The same messages, and no laser lit-rapid warning for a router.
    expect(reviewWarnings(gcode)).toEqual(projectStart.errors.map((issue) => issue.message));
    expect(reviewWarnings(gcode)).toContain(CNC_LASER_MODE_ENABLED_MESSAGE);
    expect(reviewWarnings(gcode)[0]).toBe(
      spindleScaleMismatchMessage(
        1000,
        DEFAULT_CNC_MACHINE_CONFIG.params.spindleMaxRpm,
        'dollar-settings',
      ),
    );

    // Like project Start, the findings are review warnings: Start still asks
    // only for the CNC setup attestation, and runs once it is confirmed.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await expect(startExternalProgram(framed(gcode, 'cnc'))).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toContain(CNC_SETUP_ATTESTATION_PROMPT);
    expect(writes.join('')).toContain(gcode);
  });

  it('names the lit rapids of a laser at $32=0 and asks before sending (D5-P2-2)', async () => {
    const writes = await connectReporting({ laserModeEnabled: false, maxPowerS: 1000 });
    expect(reviewWarnings(UNGUARDED)).toEqual([
      LIT_RAPIDS,
      laserModeDisabledMessage('dollar-settings'),
    ]);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await expect(startExternalProgram(framed(UNGUARDED, 'laser'))).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    const prompt = confirm.mock.calls[0]?.[0] ?? '';
    expect(prompt.startsWith(`${LIT_RAPIDS}\n\n`)).toBe(true);
    // This path has no Job Review: the prompt cites the Run review.
    expect(prompt).toContain('listed in the Run review warnings');
    expect(prompt).not.toContain('Job Review');
    expect(writes.join('')).not.toContain('G1X10Y10S800F1000');
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('warns for stored-position returns without adding a Start refusal', async () => {
    const writes = await connectReporting({ laserModeEnabled: false, maxPowerS: 1000 });
    const gcode = sent('M3 S200\nG1 X10 F100\nG28\nG30 Z0\nM5');
    expect(reviewWarnings(gcode)[0]).toContain('2 rapid commands');
    expect(reviewWarnings(gcode)[0]).toContain('first: line 4');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await expect(startExternalProgram(framed(gcode, 'laser'))).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toContain('2 rapid commands');
    expect(writes.join('')).toContain(gcode);
  });

  it('warns about stored returns at $32=1 without claiming laser mode keeps them dark', async () => {
    const writes = await connectReporting({ laserModeEnabled: true, maxPowerS: 1000 });
    const gcode = sent('M3 S200\nG1 X10 F100\nG28\nM5');
    const warnings = reviewWarnings(gcode);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('One G28/G30 stored-position return command');
    expect(warnings[0]).toContain('do not rely on $32 alone');
    expect(warnings[0]).toContain('Send S0 or M5 before the return');
    expect(reviewWarnings(sent('M3 S200\nG1 X10 F100\nG28 S0\nM5'))).toEqual([]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await expect(startExternalProgram(framed(gcode, 'laser'))).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(writes.join('')).toContain(gcode);
  });

  it('stays quiet about rapids when every G0 writes S0 at $32=0', async () => {
    const writes = await connectReporting({ laserModeEnabled: false, maxPowerS: 1000 });
    // Project Start's own output writes S0 on every G0 and gets the same two
    // things here: the $32=0 warning and the settings acknowledgement.
    expect(reviewWarnings(GUARDED)).toEqual([laserModeDisabledMessage('dollar-settings')]);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await expect(startExternalProgram(framed(GUARDED, 'laser'))).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    const prompt = confirm.mock.calls[0]?.[0] ?? '';
    expect(prompt.startsWith('Controller settings cannot be fully verified.')).toBe(true);
    expect(prompt).not.toContain('rapid');
    expect(prompt).not.toBe(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(writes.join('')).toContain(GUARDED);
  });

  it('keeps a laser in laser mode quiet: GRBL runs every G0 dark there', async () => {
    const writes = await connectReporting({ laserModeEnabled: true, maxPowerS: 1000 });
    expect(reviewWarnings(UNGUARDED)).toEqual([]);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await expect(startExternalProgram(framed(UNGUARDED, 'laser'))).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(writes.join('')).toContain(UNGUARDED);
  });

  it('says the rapids would burn when $32 is not confirmed', async () => {
    await connectReporting({ maxPowerS: 1000 });
    expect(reviewWarnings(UNGUARDED)[0]).toBe(
      'Laser mode ($32) is not confirmed. 2 rapid commands in this program run with M3 or M4 on and S not set to 0 (first: line 5 of the sent program). If laser mode is off ($32=0), each burns a line where the head travels.',
    );
  });
});
