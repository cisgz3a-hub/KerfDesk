// Air assist end to end: an operation's Air setting, through compile and the
// emitter, to the bytes the controller receives, and on to the resume preamble
// rebuilt from those bytes. The emitter rule (grbl-strategy-air-assist,
// air-assist-hold) and the Job Review advisories are pinned on their own; this
// pins that the whole chain agrees for the shipped Falcon A1 Pro profile.
import { describe, expect, it } from 'vitest';
import { buildResumeProgram } from '../../core/controllers/grbl/resume-program';
import type { DeviceProfile } from '../../core/devices';
// Deep import: the devices barrel is at its public-export ratchet.
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitPreparedGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';

type Operation = {
  readonly air: boolean;
  readonly mode?: 'line' | 'fill';
  readonly objectAir?: boolean;
};

const COLORS = ['#ff0000', '#00aa00', '#0000ff'];

function square(index: number, objectAir: boolean | undefined): SceneObject {
  const color = COLORS[index] ?? '#000000';
  return {
    kind: 'imported-svg',
    id: `O${index + 1}`,
    source: `o${index + 1}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x: 10 + index * 20 },
    ...(objectAir === undefined ? {} : { operationOverride: { airAssist: objectAir } }),
    paths: [
      {
        color,
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

function project(operations: ReadonlyArray<Operation>, device: DeviceProfile): Project {
  const layers: Layer[] = operations.map((operation, index) => ({
    ...createLayer({ id: `L${index + 1}`, color: COLORS[index] ?? '#000000' }),
    airAssist: operation.air,
    mode: operation.mode ?? 'line',
  }));
  const objects = operations.map((operation, index) => square(index, operation.objectAir));
  return { ...createProject(), device, scene: { objects, layers } };
}

function emittedLines(operations: ReadonlyArray<Operation>, device: DeviceProfile): string[] {
  const prepared = prepareOutput(project(operations, device), {
    outputScope: DEFAULT_OUTPUT_SCOPE,
  });
  if (!prepared.ok) throw new Error(`Preparation failed: ${JSON.stringify(prepared.preflight)}`);
  return emitPreparedGcode(prepared)
    .gcode.split('\n')
    .map((line) => line.trim());
}

function airWords(lines: ReadonlyArray<string>): string[] {
  return lines.filter((line) => /^M[789]$/.test(line));
}

function isBurn(line: string): boolean {
  return /^G1\b.*\bS[1-9]/.test(line);
}

// Laser resume ignores the CNC-only fields; they stay in the options shape.
const LASER_RESUME = {
  machineKind: 'laser',
  safeZMm: 0,
  spindleSpinupSec: 0,
  plungeMmPerMin: 300,
} as const;

const ON_OFF_ON: ReadonlyArray<Operation> = [
  { air: true },
  { air: false, mode: 'fill' },
  { air: true },
];

describe('air assist from operation settings to controller bytes', () => {
  it('holds the Falcon A1 Pro pump through an Air-off operation between two Air-on ones', () => {
    const lines = emittedLines(ON_OFF_ON, FALCON_A1_PRO_GRBLHAL_PROFILE);
    const m8 = lines.indexOf('M8');
    const m9 = lines.lastIndexOf('M9');

    expect(airWords(lines)).toEqual(['M8', 'M9']);
    expect(m8).toBeLessThan(lines.findIndex(isBurn));
    expect(lines.slice(m9).some(isBurn)).toBe(false);
    expect(lines.slice(m9 + 1).find((line) => line !== '')).toBe('M5');
  });

  it('switches air per operation when the profile can restart it', () => {
    const device = { ...FALCON_A1_PRO_GRBLHAL_PROFILE, airAssistRestartUnreliable: false };

    expect(airWords(emittedLines(ON_OFF_ON, device))).toEqual(['M8', 'M9', 'M8', 'M9']);
  });

  it('follows an artwork override that turns air on inside an Air-off operation', () => {
    const lines = emittedLines([{ air: false, objectAir: true }], FALCON_A1_PRO_GRBLHAL_PROFILE);

    expect(airWords(lines)).toEqual(['M8', 'M9']);
  });

  it('writes no air command when the saved profile has Air output disabled', () => {
    // Falcon A1 Pro profiles saved before the preset gained M8 (#796) carry
    // 'none'; Job Review's manual-air advisory is what tells the operator.
    const device = { ...FALCON_A1_PRO_GRBLHAL_PROFILE, airAssistCommand: 'none' as const };

    expect(airWords(emittedLines(ON_OFF_ON, device))).toEqual([]);
  });

  it('re-issues M8 when a job resumes inside the held operation, and not after the last M9', () => {
    const lines = emittedLines(ON_OFF_ON, FALCON_A1_PRO_GRBLHAL_PROFILE);
    const gcode = lines.join('\n');
    const m9 = lines.lastIndexOf('M9');
    const burns = lines.flatMap((line, index) => (isBurn(line) ? [index] : []));
    const heldBurn = burns[Math.floor(burns.length / 2)] ?? -1;

    const inside = buildResumeProgram(gcode, heldBurn + 1, LASER_RESUME);
    const after = buildResumeProgram(gcode, m9 + 2, LASER_RESUME);
    if (inside.kind !== 'ok' || after.kind !== 'ok') throw new Error('Resume was refused.');
    const insidePreamble = inside.lines.slice(0, inside.preambleCount);
    const afterPreamble = after.lines.slice(0, after.preambleCount);

    expect(insidePreamble).toContain('M8');
    expect(insidePreamble.indexOf('M8')).toBeLessThan(
      insidePreamble.findIndex((line) => line.startsWith('G0 ')),
    );
    expect(afterPreamble).not.toContain('M8');
  });
});
