import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { buildJogCommand, parseStatusReport } from '../../core/controllers/grbl';
import { buildRelativeJogCommand } from '../../core/controllers/relative-jog-commands';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
import { createProject } from '../../core/scene';
import { reportedControllerAxes, rotaryAxisFramePlan } from '../state/rotary-axis-frame';
import { FALCON_A1_PRO_BUILD_INFO } from '../../__fixtures__/controllers/falcon-a1-pro-dump';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import {
  reportedAxesOf,
  rotaryAxisMissingIssue,
  rotaryAxisStartWarnings,
} from './rotary-axis-start-warnings';
import {
  editRotaryAxis,
  editRotaryAxisConfirmed,
  editRotaryPreset,
  newRotarySetupFor,
  startRotaryEdit,
} from './rotary-setup-edit';
import { rotaryMappingSummary } from './rotary-summary';

// ADR-695: the rotary axis through the edit model, Frame, Job Review and the
// controller words it needs.
const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm: 80,
};

describe('choosing the rotary axis', () => {
  it('moves Motion per turn between millimetres and degrees and back', () => {
    const onA = editRotaryAxis(startRotaryEdit(CHUCK), 'A');
    expect(onA.setup).toEqual({ ...CHUCK, axis: 'A', mmPerRotation: 360 });
    const backOnY = editRotaryAxis(onA, 'Y');
    expect(backOnY.setup).toEqual(CHUCK);
    const onZ = editRotaryAxis(backOnY, 'Z');
    expect(onZ.setup).toEqual({ ...CHUCK, axis: 'Z' });
  });

  it('confirms the axis a Test rotation turned, and asks again for another', () => {
    const confirmed = editRotaryAxisConfirmed(editRotaryAxis(startRotaryEdit(CHUCK), 'A'), 'A');
    expect(confirmed.setup.axisConfirmed).toBe('A');
    expect(editRotaryAxis(confirmed, 'Z').setup).toMatchObject({ axis: 'Z', axisConfirmed: 'A' });
  });

  it('fills a roller preset with its roller diameter', () => {
    const edit = editRotaryPreset(startRotaryEdit(CHUCK), {
      setup: { type: 'roller', axis: 'Y', mmPerRotation: 32, roller: { diameterMm: 17 } },
    });
    expect(edit.setup).toEqual({
      enabled: true,
      type: 'roller',
      mmPerRotation: 32,
      objectDiameterMm: 80,
      rollerDiameterMm: 17,
    });
  });

  it('names the axis and its units in the summary', () => {
    expect(rotaryMappingSummary(CHUCK)).toBe('Y ×0.16, one revolution = 40 machine mm');
    expect(rotaryMappingSummary({ ...CHUCK, axis: 'A', mmPerRotation: 360 })).toBe(
      'A ×1.43, one revolution = 360°',
    );
  });
});

describe('Frame on a dedicated axis', () => {
  const project = createProject({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grblhal' });
  const bounds = { minX: 10, minY: -5, maxX: 30, maxY: 5 };
  const perimeter = [
    '$J=G90 G21 X10.000 Y-5.000 F3000\n',
    '$J=G90 G21 X30.000 Y5.000 F3000\n',
    '$J=G90 G21 X10.000 Y-5.000 F3000\n',
  ];

  it('zeroes the turn, traces it on A, and comes back to turn 0 and the pre-Frame X', () => {
    const plan = rotaryAxisFramePlan({
      project,
      axis: 'A',
      toolOffLines: ['M5\n'],
      perimeter,
      bounds,
      returnTarget: { x: 50, y: 120 },
      feed: 3000,
      buildJog: buildJogCommand,
    });
    expect(plan).toEqual({
      kind: 'ready',
      lines: [
        'M5\n',
        'G92 A0\n',
        '$J=G90 G21 X10.000 A-5.000 F3000\n',
        '$J=G90 G21 X30.000 A5.000 F3000\n',
        '$J=G90 G21 X10.000 A-5.000 F3000\n',
        '$J=G90 G21 X50.000 A0.000 F3000\n',
      ],
    });
  });

  it('is blocked where the controller reports no A axis', () => {
    const plan = rotaryAxisFramePlan({
      project,
      axis: 'A',
      toolOffLines: [],
      perimeter,
      bounds,
      returnTarget: undefined,
      feed: 3000,
      buildJog: buildJogCommand,
      reported: { statusAxisCount: 4, axisLetters: 'XYZ' },
    });
    expect(plan).toEqual({ kind: 'blocked', message: expect.stringContaining('with no A') });
  });

  it('is blocked where the controller has no such axis', () => {
    const marlin = createProject({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'marlin' });
    const plan = rotaryAxisFramePlan({
      project: marlin,
      axis: 'A',
      toolOffLines: [],
      perimeter,
      bounds,
      returnTarget: undefined,
      feed: 3000,
      buildJog: buildJogCommand,
    });
    expect(plan.kind).toBe('blocked');
  });
});

describe('Start and Job Review on a dedicated axis', () => {
  const device = {
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: 'grblhal' as const,
    rotary: { ...CHUCK, axis: 'A' as const, mmPerRotation: 360 },
  };
  const project = createProject(device);
  const status = (axes: number): StatusReport => {
    const report = parseStatusReport(`<Idle|MPos:${Array(axes).fill('0.000').join(',')}|FS:0,0>`);
    if (report === null) throw new Error('no report');
    return report;
  };

  it('refuses when the controller reports no A axis, by count or by $I letters', () => {
    expect(rotaryAxisMissingIssue(project, reportedAxesOf({ statusReport: status(3) }))).toContain(
      'the controller reports 3 axes, with no A',
    );
    expect(
      rotaryAxisMissingIssue(
        project,
        reportedAxesOf({ statusReport: status(4), reportedAxisLetters: 'XYZB' }),
      ),
    ).toContain('reports XYZB, with no A');
    expect(rotaryAxisMissingIssue(project, reportedAxesOf({ statusReport: status(4) }))).toBeNull();
    expect(rotaryAxisMissingIssue(project, reportedAxesOf({ statusReport: null }))).toBeNull();
  });

  it('reads the A1 Pro $I axes kept from the connect read', () => {
    expect(
      reportedControllerAxes({
        statusReport: null,
        controllerFirmwareReport: null,
        controllerBuildInfoRawLines: FALCON_A1_PRO_BUILD_INFO.slice(0, 8),
      }).axisLetters,
    ).toBe('XYZA');
  });

  it('warns until a Test rotation is confirmed on the axis', () => {
    expect(rotaryAxisStartWarnings(project)).toEqual([
      expect.stringContaining('No Test rotation has been confirmed on the A axis'),
    ]);
    const confirmed = createProject({
      ...device,
      rotary: { ...device.rotary, axisConfirmed: 'A' as const },
    });
    expect(rotaryAxisStartWarnings(confirmed)).toEqual([]);
  });

  it('warns a Falcon A1 Pro whose rotary is left on Y, and no Y-port machine', () => {
    const a1ProOnY = createProject({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, rotary: CHUCK });
    expect(rotaryAxisStartWarnings(a1ProOnY)).toEqual([
      expect.stringContaining("This machine's rotary connector is its A axis"),
    ]);
    const onY = createProject({ ...DEFAULT_DEVICE_PROFILE, rotary: CHUCK });
    expect(rotaryAxisStartWarnings(onY)).toEqual([]);
  });

  it('starts a new A1 Pro rotary on A, and any other machine on Y', () => {
    expect(newRotarySetupFor(FALCON_A1_PRO_GRBLHAL_PROFILE)).toMatchObject({
      axis: 'A',
      mmPerRotation: 360,
    });
    expect(newRotarySetupFor(DEFAULT_DEVICE_PROFILE).axis).toBeUndefined();
  });
});

describe('controller words for an A rotary', () => {
  it('counts the axes a status report carries', () => {
    expect(
      parseStatusReport('<Idle|MPos:0.000,0.000,0.000,12.500|FS:0,0>')?.reportedAxisCount,
    ).toBe(4);
    expect(parseStatusReport('<Idle|WPos:1.000,2.000,3.000|FS:0,0>')?.reportedAxisCount).toBe(3);
  });

  it('jogs A on GRBL-family controllers and refuses it on Marlin and Smoothieware', () => {
    expect(buildJogCommand({ da: 90, feed: 1500 })).toBe('$J=G91 G21 A90.000 F1500');
    expect(() => buildRelativeJogCommand({ da: 90, feed: 1500 })).toThrow(/no A axis/);
  });
});
