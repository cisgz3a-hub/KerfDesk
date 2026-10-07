import { describe, expect, it } from 'vitest';
import {
  CNC_OMISSION_CLOSED,
  CNC_OMISSION_LAYER_ID,
  CNC_OMISSION_OPEN_A,
  CNC_OMISSION_OPEN_B,
  cncOmissionProject,
} from '../../__fixtures__/cnc-open-contours';
import { cncPassXyPoints, type Job } from '../job/job';
import { runCncPreflight } from '../preflight/cnc-preflight';
import type { PreflightResult } from '../preflight/preflight';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncCutType, type Project } from '../scene';
import { emitGcode, emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { partitionSavePreflight } from '../../ui/app/save-preflight-policy';
import { partitionEmitPreflight } from '../../ui/laser/start-job-readiness-policy';
import {
  compileCncJob,
  finalizeCncCompilationArtifact,
  prepareBoundCncCompilation,
} from './compile-cnc-job';

const OMISSION_CODE = 'cnc-open-contours-omitted';

// Structural inspection keeps the pre-fix baseline collectable. The proposed
// optional field also allows archived Jobs created before the advisory existed.
type OpenContourOmission = {
  readonly layerId: string;
  readonly cutType: CncCutType;
  readonly count: number;
};
type OmissionSidecar = NonNullable<Job['cncCompilation']> & {
  readonly omittedOpenContours?: ReadonlyArray<OpenContourOmission>;
};

function omissionEvidence(job: Job): ReadonlyArray<OpenContourOmission> | undefined {
  return (job.cncCompilation as OmissionSidecar | undefined)?.omittedOpenContours;
}

function omissionIssues(preflight: PreflightResult) {
  return preflight.issues.filter((issue) => String(issue.code) === OMISSION_CODE);
}

function compile(project: Project): Job {
  return compileCncJob(project.scene, project.device, DEFAULT_CNC_MACHINE_CONFIG);
}

function motionX(job: Job): number[] {
  return job.groups.flatMap((group) =>
    group.kind === 'cnc'
      ? group.passes.flatMap((pass) => cncPassXyPoints(pass).map((point) => point.x))
      : [],
  );
}

function expectTwoOpenPaths(preflight: PreflightResult): void {
  const issues = omissionIssues(preflight);
  expect(issues).toHaveLength(1);
  expect(issues[0]?.message).toContain(CNC_OMISSION_LAYER_ID);
  expect(issues[0]?.message).toMatch(/\b2\b.*open|open.*\b2\b/i);
  expect(issues[0]?.message).toMatch(/skip|omit|not cut|uncut/i);
}

describe('C1 exact CNC open-contour omission evidence and review', () => {
  it('control: the mixed pocket really cuts the square and leaves both remote open strokes uncut', () => {
    const mixed = cncOmissionProject();
    const closed = cncOmissionProject([CNC_OMISSION_CLOSED]);
    const job = compile(mixed);
    const x = motionX(job);
    expect(x.length).toBeGreaterThan(0);
    expect(Math.max(...x)).toBeLessThan(30);
    expect(job.groups).toEqual(compile(closed).groups);
    expect(emitGcode(mixed).gcode).toEqual(emitGcode(closed).gcode);
    expect(emitGcode(mixed).gcode).toMatch(/\bG1\b/);
  });

  it('retains the exact count and cut type even when the same operation also has successful paths', () => {
    const job = compile(cncOmissionProject());
    expect(omissionEvidence(job)).toEqual([
      { layerId: CNC_OMISSION_LAYER_ID, cutType: 'pocket', count: 2 },
    ]);
  });

  it('ordinary emission discloses both omitted open paths once', () => {
    expectTwoOpenPaths(emitGcode(cncOmissionProject()).preflight);
  });

  it('prepared emission preserves the exact warning and executable bytes in evidence-only mode', () => {
    const prepared = prepareOutput(cncOmissionProject());
    expect(prepared.ok).toBe(true);
    const ordinary = emitPreparedGcode(prepared);
    const archived = emitPreparedGcode(structuredClone(prepared), {
      sourceGeometryChecks: 'compiled-evidence-only',
    });
    expect(archived.gcode).toEqual(ordinary.gcode);
    expectTwoOpenPaths(archived.preflight);
    expect(omissionIssues(archived.preflight)).toEqual(omissionIssues(ordinary.preflight));
  });

  it('evidence-only review reads the archived count without touching source geometry', () => {
    const project = cncOmissionProject();
    const job = structuredClone(compile(project));
    const gcode = emitGcode(project).gcode;
    const archivedProject: Project = {
      ...project,
      scene: {
        ...project.scene,
        get objects(): Project['scene']['objects'] {
          throw new Error('Archived review must not recompile source geometry');
        },
      },
    };
    expectTwoOpenPaths(
      runCncPreflight(archivedProject, DEFAULT_CNC_MACHINE_CONFIG, gcode, {
        compiledJob: job,
        sourceGeometryChecks: 'compiled-evidence-only',
      }),
    );
  });

  it('the mixed warning stays advisory on both Start and Save partitions', () => {
    const emitted = emitGcode(cncOmissionProject());
    const issue = omissionIssues(emitted.preflight)[0];
    expect(issue).toBeDefined();
    const start = partitionEmitPreflight(emitted.preflight);
    const save = partitionSavePreflight(emitted.preflight.issues);
    expect(start.blocking).toEqual([]);
    expect(save.blocking).toEqual([]);
    expect(start.warnings).toContain(issue?.message);
    expect(save.advisories).toContainEqual(issue);
  });

  it('bound compilation finalisation also retains omissions in the prepared Job', () => {
    const project = cncOmissionProject();
    const artifact = prepareBoundCncCompilation(
      { jobId: 'c1-pocket', compilationId: 'c1-pocket-prepared' },
      project.scene,
      project.device,
      DEFAULT_CNC_MACHINE_CONFIG,
    );
    expect(artifact.tasks).toEqual([]);
    const finalized = finalizeCncCompilationArtifact(artifact, []);
    expect(finalized.kind).toBe('compiled');
    if (finalized.kind !== 'compiled')
      throw new Error(`Unexpected fixture result ${finalized.kind}`);
    expect(finalized.job.groups).toEqual(compile(project).groups);
    expect(omissionEvidence(structuredClone(finalized.job))).toEqual([
      { layerId: CNC_OMISSION_LAYER_ID, cutType: 'pocket', count: 2 },
    ]);
  });

  it('all-open output retains its count while the existing factual empty-output failure remains', () => {
    const project = cncOmissionProject([CNC_OMISSION_OPEN_A, CNC_OMISSION_OPEN_B]);
    const job = compile(project);
    expect(motionX(job)).toEqual([]);
    const emitted = emitGcode(project);
    expect(emitted.preflight.issues.some((issue) => issue.code === 'empty-output')).toBe(true);
    expect(omissionEvidence(job)).toEqual([
      { layerId: CNC_OMISSION_LAYER_ID, cutType: 'pocket', count: 2 },
    ]);
    expectTwoOpenPaths(emitted.preflight);
  });

  it('a fresh closed-only compile has authoritative empty omission evidence', () => {
    expect(omissionEvidence(compile(cncOmissionProject([CNC_OMISSION_CLOSED])))).toEqual([]);
  });

  it('control: a closed-only pocket has real motion and no omission warning in either review mode', () => {
    const project = cncOmissionProject([CNC_OMISSION_CLOSED]);
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    expect(motionX(compile(project)).length).toBeGreaterThan(0);
    expect(omissionIssues(emitPreparedGcode(prepared).preflight)).toEqual([]);
    expect(
      omissionIssues(
        emitPreparedGcode(prepared, { sourceGeometryChecks: 'compiled-evidence-only' }).preflight,
      ),
    ).toEqual([]);
  });

  it('an exact empty sidecar outranks newer mixed source geometry', () => {
    const closed = cncOmissionProject([CNC_OMISSION_CLOSED]);
    const job = compile(closed);
    expect(omissionEvidence(job)).toEqual([]);
    const mixed = cncOmissionProject();
    const preflight = runCncPreflight(mixed, DEFAULT_CNC_MACHINE_CONFIG, emitGcode(closed).gcode, {
      compiledJob: job,
    });
    expect(omissionIssues(preflight)).toEqual([]);
  });

  it('control: an older archived Job with no omission evidence does not rebuild source in evidence-only mode', () => {
    const project = cncOmissionProject([CNC_OMISSION_CLOSED]);
    const job = compile(project);
    const legacySidecar = { ...job.cncCompilation } as OmissionSidecar;
    delete (legacySidecar as { omittedOpenContours?: ReadonlyArray<OpenContourOmission> })
      .omittedOpenContours;
    const legacy: Job = { ...job, cncCompilation: legacySidecar };
    const sourceUnavailable: Project = {
      ...project,
      scene: {
        ...project.scene,
        get objects(): Project['scene']['objects'] {
          throw new Error('Legacy archived review must not recompile source geometry');
        },
      },
    };
    const preflight = runCncPreflight(
      sourceUnavailable,
      DEFAULT_CNC_MACHINE_CONFIG,
      emitGcode(project).gcode,
      {
        compiledJob: legacy,
        sourceGeometryChecks: 'compiled-evidence-only',
      },
    );
    expect(omissionIssues(preflight)).toEqual([]);
  });

  it.each(['profile-outside', 'profile-inside', 'profile-on-path', 'engrave'] as const)(
    'control: %s actually cuts open strokes and has no omission warning',
    (cutType) => {
      const project = cncOmissionProject([CNC_OMISSION_OPEN_A, CNC_OMISSION_OPEN_B], cutType);
      const x = motionX(compile(project));
      expect(x).toContain(40);
      expect(x).toContain(75);
      const prepared = prepareOutput(project);
      expect(omissionIssues(emitPreparedGcode(prepared).preflight)).toEqual([]);
      expect(
        omissionIssues(
          emitPreparedGcode(prepared, { sourceGeometryChecks: 'compiled-evidence-only' }).preflight,
        ),
      ).toEqual([]);
    },
  );

  it('control: Output off excludes the open pocket operation from motion and review advisories', () => {
    const project = cncOmissionProject([CNC_OMISSION_OPEN_A, CNC_OMISSION_OPEN_B], 'pocket', false);
    expect(motionX(compile(project))).toEqual([]);
    const prepared = prepareOutput(project);
    expect(omissionIssues(emitPreparedGcode(prepared).preflight)).toEqual([]);
    expect(
      omissionIssues(
        emitPreparedGcode(prepared, { sourceGeometryChecks: 'compiled-evidence-only' }).preflight,
      ),
    ).toEqual([]);
  });
});
