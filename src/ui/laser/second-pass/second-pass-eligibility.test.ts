import { compiledFocusTestWarnings } from '../job-review/focus-test-warnings';
import { createCurrentTestExecutionArtifact } from '../../state/recovery/testing';
import { secondPassOfferable } from './second-pass-offer';
import { describe, expect, it } from 'vitest';
import { generateFocusTest } from '../../../core/job/focus-test';
import { createProject, type Project } from '../../../core/scene';
import { parseLaserSecondPassSource } from '../../../core/laser-second-pass/source';
import { prepareOutput, type PrepareOutputOptions } from '../../../io/gcode/prepare-output';
import { emitPreparedGcode } from '../../../io/gcode/emit-gcode';
import { grblStrategy } from '../../../core/output/grbl-strategy';
import { secondPassProjectEligible } from './second-pass-eligibility';

function focusProject(): Project {
  return {
    ...createProject(),
    scene: generateFocusTest({
      steps: 3,
      minOffsetMm: -1,
      maxOffsetMm: 1,
      lineLengthMm: 20,
      spacingMm: 3,
      speed: 1200,
      power: 10,
      travelFeedMmPerMin: 300,
    }),
  };
}
function inspect(project: Project, options: PrepareOutputOptions = {}) {
  const prepared = prepareOutput(project, options);
  if (!prepared.ok) throw new Error('Fixture must compile');
  const program = emitPreparedGcode(prepared).gcode;
  return {
    eligible: secondPassProjectEligible(prepared.project, prepared.job),
    parsed: parseLaserSecondPassSource(program),
    program,
  };
}
const selected = (id: string): PrepareOutputOptions => ({
  outputScope: { cutSelectedGraphics: true, useSelectionOrigin: false, selectedObjectIds: [id] },
});

describe('second-pass eligibility follows emitted Focus intent', () => {
  it('does not offer a completed nonzero Focus program that the source parser refuses', () => {
    const result = inspect(focusProject());
    expect(result.program).toContain('G1 Z');
    expect(result.parsed).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('Unsupported Z'),
    });
    expect(result.eligible).toBe(false);
  });
  it('allows the selected zero-offset sample, which emits only supported XY motion', () => {
    const result = inspect(focusProject(), selected('focus-test-2-line'));
    expect(result.program).toContain('Focus Test Z offset 0.000');
    expect(result.program).not.toContain('G1 Z');
    expect(result.parsed.kind).toBe('ready');
    expect(result.eligible).toBe(true);
  });
  it('allows ordinary selected output while retaining unused nonzero Focus operations', () => {
    const project = focusProject();
    const ordinary: Project = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer, index) => {
          if (index !== 2) return layer;
          const { focusTest: _focus, ...rest } = layer;
          return rest;
        }),
      },
    };
    const result = inspect(ordinary, selected('focus-test-3-line'));
    expect(result.program).not.toContain('Focus Test Z offset');
    expect(result.parsed.kind).toBe('ready');
    expect(result.eligible).toBe(true);
  });
  it('allows ordinary output with disabled Focus operations', () => {
    const project = focusProject();
    const result = inspect({
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer, index) => {
          if (index !== 1) return { ...layer, output: false };
          const { focusTest: _focus, ...rest } = layer;
          return rest;
        }),
      },
    });
    expect(result.parsed.kind).toBe('ready');
    expect(result.eligible).toBe(true);
  });
});

it('does not reject retained nonzero Focus metadata when its burn collapses at output precision', () => {
  const prepared = prepareOutput(focusProject());
  if (!prepared.ok) throw new Error('Fixture must compile');
  const job = {
    ...prepared.job,
    groups: prepared.job.groups.map((group) =>
      group.kind !== 'cut'
        ? group
        : {
            ...group,
            segments: [
              {
                closed: false,
                polyline: [
                  { x: 10, y: 10 },
                  { x: 10.0001, y: 10 },
                ],
              },
            ],
          },
    ),
  };
  const program = grblStrategy.emit(job, prepared.project.device);
  expect(program).not.toContain('G1 Z');
  expect(parseLaserSecondPassSource(program).kind).toBe('ready');
  expect(secondPassProjectEligible(prepared.project, job)).toBe(true);
});

it('uses the retained compiled scope for the completed archive offer', async () => {
  const project = focusProject();
  for (const [options, expected] of [
    [{}, false],
    [selected('focus-test-2-line'), true],
  ] as const) {
    const prepared = prepareOutput(project, options);
    if (!prepared.ok) throw new Error('Fixture must compile');
    const artifact = await createCurrentTestExecutionArtifact({
      runId: `focus-${expected}`,
      prepared,
      gcode: emitPreparedGcode(prepared).gcode,
    });
    expect(secondPassOfferable(artifact)).toBe(expected);
  }
});

it.each([undefined, 1, 2] as const)(
  'uses persisted power-scale version %s for archived fractional-range Focus',
  async (version) => {
    const source = focusProject();
    const compiled = prepareOutput({ ...source, device: { ...source.device, maxPowerS: 0.5 } });
    if (!compiled.ok) throw new Error('Fixture must compile');
    const { laserPowerScaleVersion: _version, ...base } = compiled;
    const prepared = version === undefined ? base : { ...base, laserPowerScaleVersion: version };
    // Historical archives omit the version but retain version-1 program bytes.
    const gcode = emitPreparedGcode({ ...prepared, laserPowerScaleVersion: version ?? 1 }).gcode;
    const emitsZ = version === 2;
    expect(gcode.includes('G1 Z')).toBe(emitsZ);
    expect(
      compiledFocusTestWarnings(prepared).some((warning) =>
        warning.startsWith('Focus Test moves Z'),
      ),
    ).toBe(emitsZ);
    const artifact = await createCurrentTestExecutionArtifact({
      runId: `fractional-focus-${version}`,
      prepared,
      gcode,
    });
    expect(secondPassOfferable(artifact)).toBe(!emitsZ);
    expect(parseLaserSecondPassSource(gcode).kind).toBe(emitsZ ? 'error' : 'ready');
    expect(secondPassProjectEligible(prepared.project, prepared.job)).toBe(false);
  },
);
