import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { cncCutExtent, type CncCutExtent } from '../../__fixtures__/returning-user/cnc-cut-extent';
import type { JobOriginPlacement } from '../../core/job';
import type { Project } from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { completeNativeProjectOpen } from '../app/project-open-completion';
import { renderVariableText } from '../text/render-variable-text';
import { oldProjectBurnReviewWarnings } from './old-project-burn-review';
import { pushProjectLoadNotices } from './project-load-notices';
import { useStore } from './store';
import { resetStore } from './test-helpers';

// Rolling audit v9 R8-P2-1: after 1.0.28 the CNC Job Origin anchor counts a
// crossing loop and a flat Drill contour (ADR-327 Amendment 1's implementation
// correction), so a job holding one moves at User Origin. The new place is the
// canvas anchor and stays; the load says how far the cut moved. The projects
// were saved by the real 1.0.28 (`33bc394c6`), which also measured where it
// cut them (`1.0.28-cnc-job-origin.cuts.json`).
const FOLDER = 'src/__fixtures__/returning-user';
const CUTS: Readonly<Record<string, CncCutExtent>> = JSON.parse(
  readFileSync(resolve(FOLDER, '1.0.28-cnc-job-origin.cuts.json'), 'utf8'),
).cuts;

function fileText(name: string): string {
  return gunzipSync(readFileSync(resolve(FOLDER, `${name}.lf2.gz`))).toString('utf8');
}

/** Opens as File > Open does and returns every toast it raised. */
function openToasts(text: string, name: string): ReadonlyArray<string> {
  const toasts: string[] = [];
  const opened = completeNativeProjectOpen(
    {
      setProject: useStore.getState().setProject,
      markLoaded: () => undefined,
      // One toast carries the result and its notes, one a line (ADR-708).
      pushToast: (message, _variant, options) =>
        toasts.push(...message.split('\n'), ...(options?.details ?? [])),
    },
    `${name}.lf2`,
    deserializeProject(text),
  );
  expect(opened).toBe(true);
  return toasts;
}

async function cutOnMain(project: Project): Promise<CncCutExtent> {
  const prepared = await prepareOutputSnapshot(project, {
    clock: () => new Date('2026-11-02T00:00:00Z'),
    renderVariableText,
    // The golden projects hold User Origin or Absolute, which need no live position.
    jobOrigin: project.jobSetup.placement as JobOriginPlacement,
  });
  if (!prepared.ok) throw new Error('output was refused');
  return cncCutExtent(emitPreparedGcode(prepared).gcode);
}

function cncNotice(toasts: ReadonlyArray<string>): string | undefined {
  return toasts.find((toast) => toast.includes('This CNC job now cuts'));
}

beforeEach(() => {
  resetStore();
  pushProjectLoadNotices({}, () => undefined, { migration: false });
});

describe('a CNC job saved by 1.0.28 whose Job Origin now counts more contours', () => {
  it.each([
    ['1.0.28-cnc-bowtie-pocket', 'a crossing loop on a Pocket at front-left'],
    ['1.0.28-cnc-flat-drill', 'a flat Drill contour at the centre anchor'],
  ])('%s (%s): the cut moves and the load names how far', async (name) => {
    const toasts = openToasts(fileText(name), name);
    const project = useStore.getState().project;
    const before = CUTS[name];
    if (before === undefined) throw new Error(`no sidecar for ${name}`);
    const now = await cutOnMain(project);
    const moved = { x: now.minX - before.minX, y: now.minY - before.minY };
    // It really moves, by a whole contour's distance.
    expect(Math.max(Math.abs(moved.x), Math.abs(moved.y))).toBeGreaterThan(10);
    // The cut keeps its size: only its place changed.
    expect(now.maxX - now.minX).toBeCloseTo(before.maxX - before.minX, 2);
    expect(now.maxY - now.minY).toBeCloseTo(before.maxY - before.minY, 2);

    const notice = cncNotice(toasts);
    expect(notice).toBeDefined();
    const named = [
      ...(Math.abs(moved.x) < 0.005 ? [] : [`${Math.abs(moved.x).toFixed(2)} mm in X`]),
      ...(Math.abs(moved.y) < 0.005 ? [] : [`${Math.abs(moved.y).toFixed(2)} mm in Y`]),
    ].join(' and ');
    expect(notice).toContain(`This CNC job now cuts ${named} away from where KerfDesk 1.0.28`);
    // Job Review repeats it while the project is open.
    expect(oldProjectBurnReviewWarnings(project)).toContain(notice);
  });

  it('the bowtie Pocket at front-left now starts at work zero, as the canvas shows', async () => {
    openToasts(fileText('1.0.28-cnc-bowtie-pocket'), 'bowtie');
    const now = await cutOnMain(useStore.getState().project);
    const before = CUTS['1.0.28-cnc-bowtie-pocket'];
    // 1.0.28 cut up to 58 mm left of work zero.
    expect(before?.minX).toBeLessThan(-50);
    // The pocket stays one bit radius inside its outline (3.175 mm bit).
    expect(now.minX).toBeCloseTo(1.588, 2);
    expect(now.minY).toBeCloseTo(1.588, 2);
  });

  it('stays silent on Absolute, which does not anchor, and its cut does not move', async () => {
    const name = '1.0.28-cnc-bowtie-absolute';
    const toasts = openToasts(fileText(name), name);
    expect(cncNotice(toasts)).toBeUndefined();
    expect(await cutOnMain(useStore.getState().project)).toEqual(CUTS[name]);
  });

  it('stays silent once the project is saved by this version', () => {
    const name = '1.0.28-cnc-bowtie-pocket';
    openToasts(fileText(name), name);
    const resaved = serializeProject(useStore.getState().project);
    expect(cncNotice(openToasts(resaved, 'resaved'))).toBeUndefined();
  });
});
