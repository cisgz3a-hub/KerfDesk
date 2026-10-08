import { describe, expect, it } from 'vitest';
import {
  canonicalCncArtwork,
  cncReviewProject,
  cncSourceEvidence,
} from '../../__fixtures__/cnc-omission-review';
import {
  CNC_OMISSION_CLOSED,
  CNC_OMISSION_LAYER_ID,
  CNC_OMISSION_OPEN_A,
  CNC_OMISSION_OPEN_B,
  cncOmissionArtwork,
  cncOmissionLayer,
} from '../../__fixtures__/cnc-open-contours';
import { cncPassXyPoints, type Job } from '../job/job';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  type CncTool,
  type Project,
} from '../scene';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { runCncCompilationTask } from './cnc-compilation-artifact';
import { collectLayerContours } from './collect-cnc-contours';
import { retainedCncCompilationSidecar } from '../recovery/cnc-retained-compilation-sidecar';
import {
  compileCncJob,
  finalizeCncCompilationArtifact,
  prepareBoundCncCompilation,
} from './compile-cnc-job';

function vcarveInputs(outlined = false) {
  const bit: CncTool = {
    id: 'c1-v90',
    name: 'C1 90 degree V-bit',
    kind: 'v-bit',
    diameterMm: 6,
    tipAngleDeg: 90,
  };
  const stroke = outlined
    ? {
        ...CNC_OMISSION_OPEN_A,
        paths: CNC_OMISSION_OPEN_A.paths.map((path) => ({ ...path, strokeWidthMm: 1 })),
      }
    : CNC_OMISSION_OPEN_A;
  const project = cncReviewProject([CNC_OMISSION_CLOSED, stroke], 'v-carve');
  const settings = cncOmissionLayer('v-carve').cnc;
  if (settings === undefined) throw new Error('Missing V-carve fixture settings');
  return {
    ...project,
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [bit], toolId: bit.id },
    scene: {
      ...project.scene,
      layers: project.scene.layers.map((layer) => ({
        ...layer,
        cnc: { ...settings, toolId: bit.id, vResolutionMm: 0.5 },
      })),
    },
  };
}

function compile(project: Project): Job {
  return compileCncJob(project.scene, project.device, DEFAULT_CNC_MACHINE_CONFIG);
}
function source(objectId: string, count = 1) {
  return { layerId: CNC_OMISSION_LAYER_ID, cutType: 'pocket', objectId, count };
}

describe('C1 compiler-owned omitted CNC source provenance', () => {
  it('records only the two genuinely uncut sources while preserving the successful pocket', () => {
    const mixed = cncReviewProject([CNC_OMISSION_CLOSED, CNC_OMISSION_OPEN_A, CNC_OMISSION_OPEN_B]);
    const job = compile(mixed);
    expect(job.groups).toEqual(compile(cncReviewProject([CNC_OMISSION_CLOSED])).groups);
    expect(cncSourceEvidence(job)).toEqual([
      source(CNC_OMISSION_OPEN_A.id),
      source(CNC_OMISSION_OPEN_B.id),
    ]);
  });

  it('counts canonical open paths per object even when compatibility flags claim closure', () => {
    const canonical = canonicalCncArtwork(
      'two-open-one-closed',
      'M40 10 H50 M40 20 Q45 24 50 20 M10 10 H20 V20 H10 Z',
      true,
    );
    const project = cncReviewProject([canonical]);
    const contours = collectLayerContours(
      project.scene.objects,
      cncOmissionLayer(),
      project.device,
    );
    expect(contours.filter((contour) => !contour.polyline.closed)).toHaveLength(2);
    expect(contours.filter((contour) => contour.polyline.closed)).toHaveLength(1);
    const job = compile(project);
    expect(job.groups.length).toBeGreaterThan(0);
    expect(cncSourceEvidence(job)).toEqual([source(canonical.id, 2)]);
  });

  it('does not call canonically closed paths omitted because their compatibility flags say open', () => {
    const canonical = canonicalCncArtwork('closed-canonical', 'M10 10 H20 V20 H10 Z', false);
    const project = cncReviewProject([canonical]);
    const collected = collectLayerContours(
      project.scene.objects,
      cncOmissionLayer(),
      project.device,
    );
    expect(collected).toHaveLength(1);
    expect(collected[0]?.polyline.closed).toBe(true);
    expect(compile(project).groups.length).toBeGreaterThan(0);
    expect(cncSourceEvidence(compile(project))).toEqual([]);
  });

  it('excludes unassigned, one-point and Output-off paths instead of inventing source omissions', () => {
    const off = { ...cncOmissionLayer(), id: 'off', output: false };
    const unassigned = {
      ...cncOmissionArtwork('unassigned', false, 90),
      paths: CNC_OMISSION_OPEN_A.paths.map((path) => ({ ...path, operationIds: [] })),
    };
    const onePoint = {
      ...cncOmissionArtwork('one-point', false, 110),
      paths: [{ color: '#000000', polylines: [{ closed: false, points: [{ x: 110, y: 10 }] }] }],
    };
    const offObject = {
      ...cncOmissionArtwork('off-object', false, 130),
      paths: CNC_OMISSION_OPEN_A.paths.map((path) => ({ ...path, operationIds: [off.id] })),
    };
    const base = cncReviewProject([CNC_OMISSION_CLOSED, CNC_OMISSION_OPEN_A]);
    const project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [...base.scene.objects, unassigned, onePoint, offObject],
        layers: [...base.scene.layers, off],
      },
    };
    expect(compile(project).groups).toEqual(compile(base).groups);
    expect(cncSourceEvidence(compile(project))).toEqual([source(CNC_OMISSION_OPEN_A.id)]);
  });

  it('retains exact source provenance through bound finalisation and structured clone', () => {
    const project = cncReviewProject([CNC_OMISSION_CLOSED, CNC_OMISSION_OPEN_A]);
    const artifact = prepareBoundCncCompilation(
      { jobId: 'c1-source-job', compilationId: 'c1-source-compile' },
      project.scene,
      project.device,
      DEFAULT_CNC_MACHINE_CONFIG,
    );
    expect(artifact.tasks).toEqual([]);
    const finalized = finalizeCncCompilationArtifact(artifact, []);
    expect(finalized.kind).toBe('compiled');
    if (finalized.kind !== 'compiled') throw new Error('Expected ordinary pocket finalisation');
    expect(cncSourceEvidence(structuredClone(finalized.job))).toEqual([
      source(CNC_OMISSION_OPEN_A.id),
    ]);
  });

  it('retains only source IDs within the genuinely prepared selected-artwork output', () => {
    const project = cncReviewProject();
    const prepared = prepareOutput(project, {
      outputScope: {
        ...DEFAULT_OUTPUT_SCOPE,
        cutSelectedGraphics: true,
        selectedObjectIds: [CNC_OMISSION_CLOSED.id, CNC_OMISSION_OPEN_B.id],
      },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('Expected executable selected closed-square control');
    const x = prepared.job.groups.flatMap((group) =>
      group.kind === 'cnc'
        ? group.passes.flatMap((pass) => cncPassXyPoints(pass).map((point) => point.x))
        : [],
    );
    expect(x.length).toBeGreaterThan(0);
    expect(Math.max(...x)).toBeLessThan(30);
    expect(cncSourceEvidence(prepared.job)).toEqual([source(CNC_OMISSION_OPEN_B.id)]);
  });

  it('retains archived exact counts and source evidence in a derived CNC recovery job', () => {
    const job = compile(cncReviewProject([CNC_OMISSION_CLOSED, CNC_OMISSION_OPEN_A]));
    expect(job.groups.length).toBeGreaterThan(0);
    const omissions = [{ layerId: CNC_OMISSION_LAYER_ID, cutType: 'pocket', count: 1 }];
    const sources = [source(CNC_OMISSION_OPEN_A.id)];
    const stored: Job = {
      ...job,
      cncCompilation: {
        ...job.cncCompilation,
        vcarveOperations: job.cncCompilation?.vcarveOperations ?? [],
        omittedOpenContours: omissions,
        omittedOpenContourSources: sources,
      } as NonNullable<Job['cncCompilation']>,
    };
    const derived = retainedCncCompilationSidecar(structuredClone(stored), job.groups);
    expect(
      (derived as { readonly omittedOpenContours?: typeof omissions } | undefined)
        ?.omittedOpenContours,
    ).toEqual(omissions);
    expect(
      cncSourceEvidence({
        groups: job.groups,
        ...(derived === undefined ? {} : { cncCompilation: derived }),
      }),
    ).toEqual(sources);
  });
  it('keeps open source IDs through actual V-carve tasks and bound finalisation', () => {
    const project = vcarveInputs();
    const artifact = prepareBoundCncCompilation(
      { jobId: 'c1-vcarve', compilationId: 'c1-vcarve-tasks' },
      project.scene,
      project.device,
      project.machine,
    );
    expect(artifact.tasks.length).toBeGreaterThan(0);
    const results = artifact.tasks.map((task) => ({
      jobId: artifact.identity.compilationId,
      taskId: task.taskId,
      result: structuredClone(runCncCompilationTask(task.payload)),
    }));
    const finalized = finalizeCncCompilationArtifact(artifact, results);
    expect(finalized.kind).toBe('compiled');
    if (finalized.kind !== 'compiled') throw new Error('Expected real V-carve task finalisation');
    expect(finalized.job.groups.length).toBeGreaterThan(0);
    expect(finalized.job.cncCompilation?.omittedOpenContours).toEqual([
      { layerId: CNC_OMISSION_LAYER_ID, cutType: 'v-carve', count: 1 },
    ]);
    expect(cncSourceEvidence(finalized.job)).toEqual([
      { ...source(CNC_OMISSION_OPEN_A.id), cutType: 'v-carve' },
    ]);
  });

  it('does not call a V-carve stroke-width outline omitted open artwork', () => {
    const project = vcarveInputs(true);
    const layer = project.scene.layers[0];
    if (layer === undefined) throw new Error('Missing V-carve fixture operation');
    const contours = collectLayerContours(project.scene.objects, layer, project.device);
    expect(contours.length).toBeGreaterThan(1);
    expect(contours.every((contour) => contour.polyline.closed)).toBe(true);
    const job = compileCncJob(project.scene, project.device, project.machine);
    expect(job.groups.length).toBeGreaterThan(0);
    expect(job.cncCompilation?.omittedOpenContours).toEqual([]);
    expect(cncSourceEvidence(job)).toEqual([]);
  });

  it('records Drill open-contour omissions while closed artwork still drills', () => {
    const project = cncReviewProject([CNC_OMISSION_CLOSED, CNC_OMISSION_OPEN_A], 'drill');
    const job = compile(project);
    expect(job.groups.length).toBeGreaterThan(0);
    expect(job.cncCompilation?.omittedOpenContours).toEqual([
      { layerId: CNC_OMISSION_LAYER_ID, cutType: 'drill', count: 1 },
    ]);
    expect(cncSourceEvidence(job)).toEqual([
      { ...source(CNC_OMISSION_OPEN_A.id), cutType: 'drill' },
    ]);
  });

  it('does not misclassify a closed degenerate contour as omitted open artwork', () => {
    const degenerate = {
      ...CNC_OMISSION_OPEN_A,
      paths: CNC_OMISSION_OPEN_A.paths.map((path) => ({
        ...path,
        polylines: path.polylines.map((polyline) => ({ ...polyline, closed: true })),
      })),
    };
    const job = compile(cncReviewProject([CNC_OMISSION_CLOSED, degenerate]));
    expect(job.groups).toEqual(compile(cncReviewProject([CNC_OMISSION_CLOSED])).groups);
    expect(job.cncCompilation?.omittedOpenContours).toEqual([]);
    expect(cncSourceEvidence(job)).toEqual([]);
  });

  it('filters both omission arrays to layers with surviving motion in a real two-operation job', () => {
    const later = { ...cncOmissionLayer(), id: 'later-pocket' };
    const laterObjects = [CNC_OMISSION_CLOSED, CNC_OMISSION_OPEN_B].map((object) => ({
      ...object,
      id: 'later-' + object.id,
      paths: object.paths.map((path) => ({ ...path, operationIds: [later.id] })),
    }));
    const project = cncReviewProject([CNC_OMISSION_CLOSED, CNC_OMISSION_OPEN_A]);
    const job = compile({
      ...project,
      scene: {
        ...project.scene,
        layers: [...project.scene.layers, later],
        objects: [
          ...project.scene.objects.map((object) =>
            'paths' in object
              ? {
                  ...object,
                  paths: object.paths.map((path) => ({
                    ...path,
                    operationIds: [CNC_OMISSION_LAYER_ID],
                  })),
                }
              : object,
          ),
          ...laterObjects,
        ],
      },
    });
    const groups = job.groups.filter((group) => group.layerId === later.id);
    expect(groups.length).toBeGreaterThan(0);
    expect(job.groups.some((group) => group.layerId === CNC_OMISSION_LAYER_ID)).toBe(true);
    const retained = retainedCncCompilationSidecar(job, groups);
    expect(retained?.omittedOpenContours).toEqual([
      { layerId: later.id, cutType: 'pocket', count: 1 },
    ]);
    expect(retained?.omittedOpenContourSources).toEqual([
      {
        layerId: later.id,
        cutType: 'pocket',
        count: 1,
        objectId: 'later-' + CNC_OMISSION_OPEN_B.id,
      },
    ]);
  });

  it('control: canonical open and closed paths remain distinguishable after real import', () => {
    const canonical = canonicalCncArtwork(
      'control-curves',
      'M40 10 Q45 20 50 10 M10 10 H20 V20 H10 Z',
      true,
    );
    const project = cncReviewProject([canonical]);
    const contours = collectLayerContours(
      project.scene.objects,
      cncOmissionLayer(),
      project.device,
    );
    expect(contours.map((contour) => contour.polyline.closed)).toEqual([false, true]);
    expect(contours.map((contour) => contour.objectId)).toEqual([canonical.id, canonical.id]);
  });

  it('control: profile and engraving output really consumes the open sources', () => {
    for (const cutType of ['profile-on-path', 'engrave'] as const) {
      const job = compile(cncReviewProject([CNC_OMISSION_OPEN_A, CNC_OMISSION_OPEN_B], cutType));
      const x = job.groups.flatMap((group) =>
        group.kind === 'cnc'
          ? group.passes.flatMap((pass) => cncPassXyPoints(pass).map((point) => point.x))
          : [],
      );
      expect(x).toContain(40);
      expect(x).toContain(75);
    }
  });
});
