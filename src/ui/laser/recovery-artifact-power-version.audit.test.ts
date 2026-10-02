import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import {
  buildLaserSecondPassProgram,
  parseLaserSecondPassSource,
} from '../../core/laser-second-pass';
import { fingerprintGcode } from '../../core/recovery';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import {
  hydratePreparedExecutionOutput,
  prepareOutputForStructuredClone,
  type SuccessfulPreparedOutput,
} from '../../io/gcode/prepared-output-persistence';
import { isExecutionArtifact } from '../state/recovery/execution-artifact';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing';
import { recoveryArtifactPreparedProgramMatches } from './recovery-artifact-binding';

function project(kind: 'vector' | 'image'): Project {
  const base = createProject();
  const color = '#ff0000';
  const geometry = {
    id: 'art',
    source: 'audit',
    color,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 10, minY: 10, maxX: 13, maxY: 11 },
  };
  return {
    ...base,
    device: { ...base.device, maxPowerS: 1000.25 },
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'red', color, mode: kind === 'image' ? 'image' : 'line' }),
          power: 100,
          speed: 1500,
          linesPerMm: 1,
          ditherAlgorithm: 'grayscale',
        },
      ],
      objects: [
        kind === 'image'
          ? {
              ...geometry,
              kind: 'raster-image',
              dataUrl: 'data:image/png;base64,AA==',
              pixelWidth: 3,
              pixelHeight: 1,
              lumaBase64: 'AID/',
              dither: 'grayscale',
              linesPerMm: 1,
            }
          : {
              ...geometry,
              kind: 'imported-svg',
              paths: [
                {
                  color,
                  polylines: [
                    {
                      points: [
                        { x: 10, y: 10 },
                        { x: 13, y: 10 },
                      ],
                      closed: false,
                    },
                  ],
                },
              ],
            },
      ],
    },
  };
}

function prepared(kind: 'vector' | 'image', legacy = false): SuccessfulPreparedOutput {
  const result = prepareOutput(project(kind));
  if (!result.ok) throw new Error('Expected power fixture');
  if (!legacy) return result;
  const { laserPowerScaleVersion: _version, ...unversioned } = result;
  return {
    ...unversioned,
    job: compileJob(result.project.scene, result.project.device, 1),
  };
}

function sourceBytes(output: SuccessfulPreparedOutput): string {
  // Golden S1000/S498 endpoints were independently emitted by e220d01f.
  // Missing archive versions use historical version 1, not the current writer.
  return emitPreparedGcode({ ...output, laserPowerScaleVersion: 1 }).gcode;
}

async function archive(output: SuccessfulPreparedOutput, gcode: string) {
  return createCurrentTestExecutionArtifact({ runId: 'power-version', prepared: output, gcode });
}

function providerRecipe(output: SuccessfulPreparedOutput): SuccessfulPreparedOutput {
  return prepareOutputForStructuredClone({
    ...output,
    job: {
      ...output.job,
      groups: output.job.groups.map((group) =>
        group.kind === 'raster'
          ? {
              ...group,
              rowProvider: () => group.sValues,
            }
          : group,
      ),
    },
  });
}

describe('archived power versions survive the update', () => {
  it('preserves an unversioned fractional vector archive and rejects reinterpretation', async () => {
    const old = prepared('vector', true);
    const gcode = sourceBytes(old);
    expect(gcode).toMatch(/ S1000\n/);
    expect(gcode).not.toContain('S1000.25');
    const saved = await archive(old, gcode);
    expect(saved.prepared.laserPowerScaleVersion).toBeUndefined();
    expect(recoveryArtifactPreparedProgramMatches(saved)).toBe(true);
    expect(
      recoveryArtifactPreparedProgramMatches({
        ...saved,
        prepared: { ...saved.prepared, laserPowerScaleVersion: 2 },
      }),
    ).toBe(false);
    expect(saved.gcode).toBe(gcode);
  });

  it.each([1, 2] as const)(
    'rehydrates streamed raster recipe version %s without changing tones or bytes',
    async (version) => {
      const output = prepared('image', version === 1);
      const gcode = version === 1 ? sourceBytes(output) : emitPreparedGcode(output).gcode;
      if (version === 1) {
        expect(gcode).toContain('S1000');
        expect(gcode).toContain('S498');
      } else expect(gcode).toContain('S1000.25');
      const saved = await archive(providerRecipe(output), gcode);
      const hydrated = hydratePreparedExecutionOutput(saved.prepared);
      expect(hydrated?.laserPowerScaleVersion).toBe(version);
      expect(emitPreparedGcode(hydrated ?? output).gcode).toBe(gcode);
      expect(recoveryArtifactPreparedProgramMatches(saved)).toBe(true);
      expect(saved.gcode).toBe(gcode);
    },
  );

  it('replays a second-pass stage whose base used historical fractional power', async () => {
    const output = prepared('vector', true);
    const source = sourceBytes(output);
    const parsed = parseLaserSecondPassSource(source);
    if (parsed.kind !== 'ready') throw new Error(parsed.message);
    const burn = parsed.segments.find((segment) => segment.power > 0)!;
    const selection = {
      version: 1 as const,
      maxPowerS: output.project.device.maxPowerS,
      strokes: [
        {
          id: 'mark',
          mode: 'paint' as const,
          radiusMm: 1,
          powerScale: 1,
          points: [{ x: (burn.from.x + burn.to.x) / 2, y: burn.from.y }],
        },
      ],
    };
    const second = buildLaserSecondPassProgram(source, selection, { writerVersion: 3 });
    if (second.kind !== 'ready') throw new Error(second.message);
    const saved = await archive(output, second.gcode);
    const chained = {
      ...saved,
      laserSecondPassChain: [
        {
          sourceRunId: 'old',
          sourceFingerprint: fingerprintGcode(source),
          resumeChainBefore: [],
          selection,
          writerVersion: 3 as const,
        },
      ],
    };
    expect(recoveryArtifactPreparedProgramMatches(chained)).toBe(true);
    expect(chained.gcode).toBe(second.gcode);
  });

  it('rejects unknown power versions at hydration and artifact decode', async () => {
    const output = prepared('vector');
    const saved = await archive(output, emitPreparedGcode(output).gcode);
    const tampered = { ...saved, prepared: { ...saved.prepared, laserPowerScaleVersion: 3 } };
    expect(isExecutionArtifact(tampered)).toBe(false);
    expect(
      hydratePreparedExecutionOutput(tampered.prepared as unknown as SuccessfulPreparedOutput),
    ).toBeNull();
  });

  it('retains historical fractional Marlin-inline power and ignores observed GRBL normalization', () => {
    const authored = project('vector');
    const marlin = {
      ...authored,
      device: {
        ...authored.device,
        controllerKind: 'marlin' as const,
        gcodeDialect: { dialectId: 'marlin-inline' as const },
      },
    };
    const output = prepareOutput(marlin);
    expect(emitPreparedGcode(output).gcode).toMatch(/ S1000\n/);
    expect(emitPreparedGcode(output).gcode).not.toContain('S1000.25');
  });
});
