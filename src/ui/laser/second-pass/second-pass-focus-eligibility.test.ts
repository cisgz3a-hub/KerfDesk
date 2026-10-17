import { describe, expect, it } from 'vitest';
import { generateFocusTest } from '../../../core/job/focus-test';
import { parseLaserSecondPassSource } from '../../../core/laser-second-pass';
import { createLayer, createProject, type OutputScope, type Project } from '../../../core/scene';
import { emitPreparedGcode } from '../../../io/gcode/emit-gcode';
import { prepareOutput } from '../../../io/gcode/prepare-output';
import { createCurrentTestExecutionArtifact } from '../../state/recovery/testing';
import { secondPassProjectEligible } from './second-pass-eligibility';
import { secondPassOfferable } from './second-pass-offer';

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

async function expectEligibility(project: Project, eligible: boolean, outputScope?: OutputScope) {
  const prepared = prepareOutput(project, outputScope === undefined ? {} : { outputScope });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw new Error('Fixture output did not prepare');
  const { gcode } = emitPreparedGcode(prepared);
  expect(secondPassProjectEligible(prepared.project, prepared.job)).toBe(eligible);
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'focus-second-pass',
    prepared,
    gcode,
  });
  expect(secondPassOfferable(artifact)).toBe(eligible);
  const parsed = parseLaserSecondPassSource(gcode);
  expect(parsed.kind).toBe(eligible ? 'ready' : 'error');
  if (parsed.kind === 'error') expect(parsed.message).toContain('Unsupported Z word');
  return prepared;
}

describe('painted second-pass Focus eligibility follows emitted motion', () => {
  it('does not offer a completed Z sweep that the XY parser cannot read', async () => {
    await expectEligibility(focusProject(), false);
  });

  it('allows an isolated zero-offset sample despite retained nonzero Focus layers', async () => {
    await expectEligibility(focusProject(), true, {
      cutSelectedGraphics: true,
      useSelectionOrigin: false,
      selectedObjectIds: ['focus-test-2-line'],
    });
  });

  it.each(['unselected', 'disabled', 'deleted'] as const)(
    'allows ordinary output with %s Focus artwork',
    async (kind) => {
      const project = focusProject();
      const mixed = {
        ...project,
        scene: {
          ...project.scene,
          layers: [
            ...project.scene.layers.map((layer) => ({ ...layer, output: kind !== 'disabled' })),
            createLayer({ id: 'ordinary', color: '#123456' }),
          ],
          objects: [
            ...(kind === 'deleted' ? [] : project.scene.objects),
            { ...project.scene.objects[0]!, id: 'ordinary-line', operationIds: ['ordinary'] },
          ],
        },
      };
      await expectEligibility(mixed, true, {
        cutSelectedGraphics: kind === 'unselected',
        useSelectionOrigin: false,
        selectedObjectIds: ['ordinary-line'],
      });
    },
  );

  it.each(['zero-passes', 'rounded-away'] as const)(
    'allows XY output when nonzero Focus groups are %s',
    async (kind) => {
      const project = focusProject();
      const prepared = prepareOutput(project);
      if (!prepared.ok) throw new Error('Fixture output did not prepare');
      const job = {
        ...prepared.job,
        groups: prepared.job.groups.map((group) => {
          if (group.kind !== 'cut' || group.focusTest?.offsetMm === 0) return group;
          return kind === 'zero-passes'
            ? { ...group, passes: 0 }
            : {
                ...group,
                segments: group.segments.map((segment) => ({
                  ...segment,
                  polyline: [
                    { x: 10, y: 10 },
                    { x: 10.0001, y: 10.0001 },
                  ],
                })),
              };
        }),
      };
      const adjusted = { ...prepared, job };
      const { gcode } = emitPreparedGcode(adjusted);
      expect(secondPassProjectEligible(adjusted.project, job)).toBe(true);
      expect(parseLaserSecondPassSource(gcode).kind).toBe('ready');
      expect(gcode).not.toMatch(/^G1 Z/m);
    },
  );
});
