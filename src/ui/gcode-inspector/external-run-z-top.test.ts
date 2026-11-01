// Rolling audit v5 J7-P2-2 (ADR-491 Amendment 3): Start checks a CNC job's
// park lift against the live Z top (Amendment 2), but Run G-code file did
// not, though every per-bit file of a setup package ends with the same
// `G0 Z<park>`. The Run review now checks the program's own lifts with the
// same evidence. The file here is a real per-bit program from the setup
// package builder, normalized and parsed as the Run dialog does.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { normalizeExternalProgram, reviewExternalProgram } from '../../core/external-program';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import { preparedCncToolSections } from '../../__fixtures__/cnc-tool-programs';
import { buildCncToolPrograms } from '../../io/cnc/cnc-tool-programs';
import type { CncZTopEvidence } from '../laser/cnc-park-z-top';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { externalZTopWarnings } from './external-run-z-top';

const DEVICE = { ...DEFAULT_DEVICE_PROFILE, zTravelMm: 75 };
const CNC_PROJECT: Project = { ...createProject(DEVICE), machine: DEFAULT_CNC_MACHINE_CONFIG };
const HEAD = { x: 0, y: 0, z: 2 };

/** A homed stock GRBL router, $132=75, $23=0 (Z homes up, machine Z 0 at the top), limits off,
 * with the stock top zeroed `belowTopMm` under the homed top. */
function homedRouter(belowTopMm: number, patch: Partial<CncZTopEvidence> = {}): CncZTopEvidence {
  const base = stockNativeEvidence(DEVICE, false, 0);
  return {
    ...base,
    controllerSettings: {
      ...base.controllerSettings,
      zTravelMm: 75,
      softLimitsEnabled: false,
      hardLimitsEnabled: false,
    },
    wcoCache: { x: -200, y: -150, z: -belowTopMm },
    activeWcs: 'G54',
    ...patch,
  };
}

// The first bit's file of a setup package; its groups park at Z8.
function perBitFile(): string {
  const result = buildCncToolPrograms(preparedCncToolSections(), {});
  if (result.kind !== 'ready') throw new Error(result.message);
  const [first] = result.programs;
  if (first === undefined) throw new Error('no programs');
  return first.gcode;
}

function zLiftsOf(file: string) {
  const normalized = normalizeExternalProgram(file);
  if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('\n'));
  const gcode = normalized.program.gcode;
  const parsed = buildGcodeRenderModel(gcode, {
    machineKind: 'cnc',
    initialPositionMm: HEAD,
    boundsFromStart: true,
  });
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  return reviewExternalProgram(gcode, parsed.model, {
    machineKind: 'cnc',
    laserMaxPowerS: 1000,
    start: HEAD,
  }).zLifts;
}

describe('Run G-code file: the program lifts against the live Z top', () => {
  it("warns when a per-bit file's park lift runs past the top with the work zero set now", () => {
    const file = perBitFile();
    expect(file.trimEnd().split('\n')).toContain('G0 Z8.000');
    const lifts = zLiftsOf(file);
    expect(lifts.workMaxMm).toBe(8);

    // Zeroed 5 mm under the top: the park lands 3 mm past it.
    const [warning, ...rest] = externalZTopWarnings(lifts, homedRouter(5), CNC_PROJECT);
    expect(rest).toEqual([]);
    expect(warning).toBe(
      'The program lifts to Z8, 3 mm past the top of Z travel with the work zero set now. ' +
        'Z runs into its stop: with limits on the controller alarms, with them off Z stalls and ' +
        'loses steps, so the next job on this zero cuts deeper. Keep the program at Z5 or lower ' +
        '(for a KerfDesk file, set Park height to 5 mm or lower and save the file again), or zero ' +
        'Z higher.',
    );
    // Zeroed 40 mm under the top it fits.
    expect(externalZTopWarnings(lifts, homedRouter(40), CNC_PROJECT)).toEqual([]);
  });

  it('says to zero again when the work zero sits above the top', () => {
    const [warning] = externalZTopWarnings(
      { workMaxMm: 8, machineMaxMm: null },
      homedRouter(-1),
      CNC_PROJECT,
    );
    expect(warning).toContain('9 mm past the top of Z travel');
    expect(warning).toContain('The work zero sits above the top of Z travel: zero Z again');
  });

  it('checks a G53 lift as a machine Z, with no work offset needed', () => {
    const evidence = homedRouter(40, { wcoCache: null });
    expect(
      externalZTopWarnings({ workMaxMm: null, machineMaxMm: 3 }, evidence, CNC_PROJECT),
    ).toEqual([
      'The program moves to machine Z3 (G53), 3 mm past the top of Z travel. Z runs into its ' +
        'stop: with limits on the controller alarms, with them off Z stalls and loses steps, so ' +
        'the next job on this zero cuts deeper. Keep its G53 moves at machine Z0 or lower.',
    ]);
    expect(
      externalZTopWarnings({ workMaxMm: null, machineMaxMm: -1 }, evidence, CNC_PROJECT),
    ).toEqual([]);
  });

  it('stays quiet when the top is not known, and for a Laser project', () => {
    const lifts = { workMaxMm: 50, machineMaxMm: 3 };
    // No Home this session and soft limits off: the Z top is not known.
    const unhomed = homedRouter(5, { homingState: 'unknown' });
    expect(externalZTopWarnings(lifts, unhomed, CNC_PROJECT)).toEqual([]);
    expect(externalZTopWarnings(lifts, homedRouter(5), createProject(DEVICE))).toEqual([]);
  });
});
