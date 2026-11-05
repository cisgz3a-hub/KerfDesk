// Performance audit S8-P2-1: adaptive clearing on a pocket its one entry
// cannot open cuts offset rings, byte for byte. Preview and Job Review now say
// so before anything is saved, in the words the Save and Start advisory uses,
// and the program is the one main wrote before the change.

import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ciBudgetMs } from '../../__fixtures__/ci-budget';
import {
  benchmarkLayer,
  benchmarkProject,
  benchmarkRectangle,
  benchmarkVector,
} from '../../__fixtures__/cnc-leader-fixtures';
import { ADAPTIVE_ENGAGEMENT_REFUSAL } from '../../core/cnc/cnc-strategy-fallback-notice';
import type { CncLayerSettings, Project } from '../../core/scene';
import { emitPreparedGcode, prepareOutput, type PreparedOutput } from '../../io/gcode';
import { deserializeProject, serializeProject } from '../../io/project';
import { buildEffectiveOperationReview } from '../laser/job-review/job-review-effective-operations';
import { cncOperationDetail } from '../laser/job-review/job-review-detail-facts';
import { buildPreviewToolpathFromPrepared } from './draw-preview';
import { previewCncFallbacksOf } from './preview-cnc-fallbacks';
import { previewStatusOverlayModel } from './preview-status-overlay-model';

const NOTICE =
  "Adaptive can't open this pocket from one entry, so it will cut offset rings " +
  'instead (full-width first pass). Pockets longer than they are wide do this. Choose Offset ' +
  'rings to remove this notice.';

// The audit's fixture (zz-s8r/emit-r.mjs): a 6 mm end mill, 3 mm deep in
// 1.5 mm passes, 40% stepover, the default 0.6 mm Radial engagement.
// The layer keeps the fixture's name, which the program's comments carry.
function rectanglePocket(
  widthMm: number,
  heightMm: number,
  strategy: NonNullable<CncLayerSettings['pocketStrategy']>,
): Project {
  const base = benchmarkProject();
  const layer = benchmarkLayer('bg', {
    cutType: 'pocket',
    pocketStrategy: strategy,
    depthMm: 3,
    depthPerPassMm: 1.5,
    toolId: 'end6',
    stepoverPercent: 40,
  });
  const vector = benchmarkVector('r', [benchmarkRectangle(10, 10, widthMm, heightMm)], ['bg']);
  const project = { ...base, scene: { layers: [layer], objects: [vector] } };
  const loaded = deserializeProject(serializeProject(project));
  if (loaded.kind !== 'ok') throw new Error('fixture project did not load');
  return loaded.project;
}

type Prepared = Extract<PreparedOutput, { readonly ok: true }>;

function prepared(project: Project): Prepared {
  const result = prepareOutput(project);
  if (!result.ok) throw new Error('fixture project did not prepare');
  return result;
}

function sha16(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// Preview and Job Review read the compiled job, so each case prepares once.
// Emitting verifies the plan again (emit preflight, performance audit
// S8-P3-1), which costs as long again as preparing on 270 x 170 mm, so the
// program itself is checked on the smaller pockets.
describe.each([
  { width: 40, height: 20 },
  { width: 100, height: 96 },
  { width: 270, height: 170 },
])('a $width x $height mm adaptive pocket', ({ width, height }) => {
  let project: Project;
  let adaptive: Prepared;

  beforeAll(
    () => {
      project = rectanglePocket(width, height, 'adaptive');
      adaptive = prepared(project);
    },
    ciBudgetMs(120_000, 300_000),
  );

  it('records the fallback and its cause on the compiled job', () => {
    expect(adaptive.job.cncCompilation?.strategyFallbacks).toEqual([
      { layerId: 'bg', kind: 'adaptive-offset', reason: ADAPTIVE_ENGAGEMENT_REFUSAL },
    ]);
  });

  it('shows it in Preview before anything is saved', () => {
    const toolpath = buildPreviewToolpathFromPrepared(project, adaptive);
    expect(previewCncFallbacksOf(toolpath)).toEqual([`bg: ${NOTICE}`]);
    const model = previewStatusOverlayModel(project, toolpath);
    expect(model.cncFallbacks).toEqual([`bg: ${NOTICE}`]);
    expect(model.visible).toBe(true);
  });

  it('names the cut in Job Review', () => {
    const effective = buildEffectiveOperationReview(adaptive.job, adaptive.project.scene);
    const operation = effective.find((entry) => entry.layerId === 'bg');
    expect(operation?.strategyFallback).toBe('adaptive-offset');
    const settings = adaptive.project.scene.layers[0]?.cnc;
    if (settings === undefined) throw new Error('expected a CNC layer');
    const detail = cncOperationDetail(
      settings,
      undefined,
      operation?.plungingReliefStages,
      operation?.relief,
      operation?.unrampedShapes,
      operation?.tabbedShapes === true,
      operation?.strategyFallback,
    );
    expect(detail).toContain('offset rings (adaptive fell back)');
    expect(detail).not.toContain('adaptive pocket');
  });
});

describe.each([
  // The hash main wrote before this change (S8 refuter, emit-r.mjs).
  { width: 40, height: 20, mainSha: '141a145c18dda7c8' },
  { width: 100, height: 96, mainSha: undefined },
])('the $width x $height mm fallback program', ({ width, height, mainSha }) => {
  it(
    'is the Offset rings program byte for byte, as main wrote, and its advisory names the cause',
    () => {
      const emitted = emitPreparedGcode(prepared(rectanglePocket(width, height, 'adaptive')));
      const adaptiveGcode = emitted.gcode ?? '';
      const offset = emitPreparedGcode(prepared(rectanglePocket(width, height, 'offset')));
      expect(adaptiveGcode.length).toBeGreaterThan(0);
      expect(adaptiveGcode).toBe(offset.gcode);
      if (mainSha !== undefined) expect(sha16(adaptiveGcode)).toBe(mainSha);
      const advisory = emitted.preflight?.issues.find(
        (issue) => issue.code === 'cnc-adaptive-clearing-invalid',
      );
      expect(advisory?.message).toBe(`Layer bg: ${NOTICE}`);
      expect(advisory?.message).not.toContain('Radial engagement or');
    },
    ciBudgetMs(120_000, 300_000),
  );
});

it(
  'cuts an accepted 40 x 40 mm adaptive pocket as main did, with nothing to disclose',
  () => {
    const project = rectanglePocket(40, 40, 'adaptive');
    const adaptive = prepared(project);
    expect(adaptive.job.cncCompilation?.strategyFallbacks).toBeUndefined();
    expect(previewCncFallbacksOf(buildPreviewToolpathFromPrepared(project, adaptive))).toEqual([]);
    expect(sha16(emitPreparedGcode(adaptive).gcode ?? '')).toBe('cc06816c27214137');
  },
  ciBudgetMs(60_000, 120_000),
);
