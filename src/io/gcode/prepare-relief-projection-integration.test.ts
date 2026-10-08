import { describe, expect, it } from 'vitest';
import {
  reliefProjectionProject,
  reliefProjectionSelection,
} from '../../__fixtures__/relief-projection';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import type { Project } from '../../core/scene/project';
import type { ImportedSvg, Transform, Vec2 } from '../../core/scene/scene-object';
import type { CncGroup, Job } from '../../core/job/job';
import { toMachineCoords } from '../../core/devices';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { detectCncReliefPlanningWarnings } from '../../ui/laser/cnc-relief-planning-warnings';
import { prepareOutput } from './prepare-output';
import { prepareOutputAsync } from './prepare-output-async';

function toolReorderedProject(): Project {
  const original = reliefProjectionProject();
  const machine = original.machine;
  if (machine?.kind !== 'cnc') throw new Error('Not CNC');
  const vector = original.scene.objects.find((object) => object.id === 'vector') as ImportedSvg;
  return {
    ...original,
    machine: {
      ...machine,
      tools: [...machine.tools, { id: 'rough', name: 'Rough', kind: 'end-mill', diameterMm: 1.5 }],
    },
    scene: {
      ...original.scene,
      artworkOrder: ['seed', 'relief', 'vector'],
      objects: [...original.scene.objects, { ...vector, id: 'seed', operationIds: ['seed'] }],
      layers: [
        {
          ...createLayer({ id: 'seed', name: 'Earlier same tool', color: '#111111' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave', toolId: 'ball' },
        },
        ...original.scene.layers.map((layer) =>
          layer.id === 'target'
            ? {
                ...layer,
                name: 'Named surface',
                output: true,
                cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: 'rough', depthPerPassMm: 1 },
              }
            : layer,
        ),
      ],
    },
  };
}
function cncGroups(project: Project) {
  const result = prepareOutput(project);
  if (!result.ok) throw new Error(JSON.stringify(result.preflight));
  return {
    result,
    groups: result.job.groups.filter((group): group is CncGroup => group.kind === 'cnc'),
  };
}
describe('exact projected relief output integration', () => {
  it.each(['engrave', 'profile-on-path'] as const)(
    'preserves open projected %s motion with authoritative empty omission evidence',
    (cutType) => {
      const original = reliefProjectionProject();
      const project = {
        ...original,
        scene: {
          ...original.scene,
          layers: original.scene.layers.map((layer) =>
            layer.id === 'engrave'
              ? { ...layer, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...layer.cnc, cutType } }
              : layer,
          ),
        },
      };
      const { result, groups } = cncGroups(project);
      expect(result.job.cncCompilation?.omittedOpenContours).toEqual([]);
      expect(result.job.cncCompilation?.omittedOpenContourSources).toEqual([]);
      expect(groups).toHaveLength(1);
      const pass = groups[0]?.passes[0];
      if (pass?.kind !== 'path3d') throw new Error('Missing projected cutting motion');
      expect(pass.closed).toBe(false);
      expect(pass.points.length).toBeGreaterThan(1);
      expect(pass.points.some((point) => point.z < 0)).toBe(true);
      expect(result.job.cncCompilation?.reliefPlans).toContainEqual(
        expect.objectContaining({ stage: 'projection', targetObjectId: 'relief' }),
      );
    },
  );
  it('warns when final tool grouping engraves before the target machining despite artwork order', () => {
    const original = toolReorderedProject();
    const { result, groups } = cncGroups(original);
    expect(groups.map((group) => [group.sourceObjectId, group.cutType])).toEqual([
      ['seed', 'engrave'],
      ['vector', 'engrave'],
      ['relief', 'relief-rough'],
    ]);
    expect(result.job.cncCompilation?.reliefPlans).toContainEqual(
      expect.objectContaining({ stage: 'projection', targetObjectId: 'relief', targetRevision: 2 }),
    );
    expect(
      detectCncReliefPlanningWarnings(result.project, result.job, 'compiled-evidence-only'),
    ).toContainEqual(
      expect.stringContaining('runs before later relief machining on layer "Named surface"'),
    );
    expect(groups.find((group) => group.layerId === 'engrave')?.depthPerPassMm).toBeUndefined();
    expect(groups.find((group) => group.layerId === 'engrave')?.requestedDepthMm).toBeUndefined();
    expect(groups.find((group) => group.layerId === 'target')?.depthPerPassMm).toBe(1);
  });
  it('does not claim a target dependency using a different object with the same source filename', () => {
    const original = toolReorderedProject();
    const { result } = cncGroups(original);
    const plans = result.job.cncCompilation?.reliefPlans ?? [];
    const job = {
      ...result.job,
      cncCompilation: {
        ...result.job.cncCompilation!,
        reliefPlans: plans.map((plan) =>
          plan.stage === 'projection' ? { ...plan, targetObjectId: 'other' } : plan,
        ),
      },
    };
    expect(
      detectCncReliefPlanningWarnings(result.project, job, 'compiled-evidence-only').some(
        (warning) => warning.includes('runs before later relief machining'),
      ),
    ).toBe(false);
  });
  it('does not warn when the final target machining precedes projection', () => {
    const original = toolReorderedProject();
    const { result } = cncGroups(original);
    const groups = result.job.groups;
    const ordered = { ...result.job, groups: [groups[2]!, groups[0]!, groups[1]!] };
    expect(
      detectCncReliefPlanningWarnings(result.project, ordered, 'compiled-evidence-only').some(
        (warning) => warning.includes('runs before later relief machining'),
      ),
    ).toBe(false);
  });
  it.each(['x', 'y'] as const)(
    'preserves local field Z and independently derived side-B %s coordinates under scale, mirror and rotation',
    (flipAxis) => {
      const original = reliefProjectionProject();
      const machine = original.machine;
      if (machine?.kind !== 'cnc') throw new Error('Not CNC');
      const placement: Transform = {
        x: 40,
        y: 50,
        scaleX: 1.7,
        scaleY: 0.8,
        rotationDeg: 23,
        mirrorX: true,
        mirrorY: false,
      };
      const linkedStart = worldPoint({ x: 3, y: 0 }, placement);
      const project: Project = {
        ...original,
        device: { ...original.device, origin: 'rear-left' },
        machine: {
          ...machine,
          stock: { ...machine.stock, widthMm: 100, heightMm: 80, originOffset: { x: 10, y: 20 } },
        },
        cncSetup: {
          ...defaultCncMachiningSetup(),
          twoSided: {
            activeSide: 'B',
            flipAxis,
            sideBStockOriginMm: { x: 4, y: 7 },
            sideAObjectIds: [],
            sideBObjectIds: ['vector'],
            registration: [],
          },
        },
        scene: {
          ...original.scene,
          objects: original.scene.objects.map((object) => ({
            ...object,
            transform:
              object.id === 'boundary'
                ? { ...placement, x: linkedStart.x, y: linkedStart.y }
                : placement,
          })),
        },
      };
      const prepared = prepareOutput(project, { outputScope: reliefProjectionSelection });
      if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight));
      expect(prepared.project.scene.objects.map((object) => object.id)).toEqual(['vector']);
      expect(prepared.project.scene.outputDependencies?.map((object) => object.id)).toEqual([
        'relief',
      ]);
      const point = firstProjectedPoint(prepared.job);
      const before = toMachineCoords(worldPoint({ x: 1.5, y: 1.5 }, placement), project.device);
      const expected =
        flipAxis === 'y'
          ? { x: 4 + 100 - (before.x - 10), y: 7 + before.y - 20 }
          : { x: 4 + before.x - 10, y: 7 + 80 - (before.y - 20) };
      expect(point.x).toBeCloseTo(expected.x, 8);
      expect(point.y).toBeCloseTo(expected.y, 8);
      expect(point.z).toBeCloseTo(-5 * (1 - 10000 / 65535) - 0.2, 4);
      expect(prepared.job.cncCompilation?.reliefPlans?.[0]).toMatchObject({
        targetObjectId: 'relief',
        targetRevision: 2,
      });
      expect(project.scene.objects[0]?.transform).toBe(placement);
    },
  );
  it('retains a refreshed off-output target through asynchronous compilation finalization', async () => {
    const original = reliefProjectionProject();
    const sync = prepareOutput(original, { outputScope: reliefProjectionSelection });
    const asyncResult = await prepareOutputAsync(
      original,
      { outputScope: reliefProjectionSelection },
      {
        jobId: 'retained-projection',
        runCncTasks: async () => {
          throw new Error('Projection has no independent V-carve tasks');
        },
      },
    );
    if (!sync.ok || !asyncResult.ok) throw new Error('Preparation failed');
    expect(asyncResult.job).toEqual(sync.job);
    expect(asyncResult.project.scene.outputDependencies).toEqual(
      sync.project.scene.outputDependencies,
    );
    expect(asyncResult.job.cncCompilation?.reliefPlans?.[0]).toMatchObject({
      stage: 'projection',
      targetRevision: 2,
    });
  });
});
function worldPoint(point: Vec2, transform: Transform): Vec2 {
  const x = -point.x * transform.scaleX,
    y = point.y * transform.scaleY;
  const angle = (transform.rotationDeg * Math.PI) / 180;
  return {
    x: transform.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: transform.y + x * Math.sin(angle) + y * Math.cos(angle),
  };
}

function firstProjectedPoint(job: Job) {
  const group = job.groups[0];
  if (group?.kind !== 'cnc' || group.passes[0]?.kind !== 'path3d')
    throw new Error('Missing projection');
  return group.passes[0].points[0]!;
}
