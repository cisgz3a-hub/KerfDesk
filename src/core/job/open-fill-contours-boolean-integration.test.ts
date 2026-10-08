import { describe, expect, it } from 'vitest';
import { expandBooleanCompound, retainBooleanCompoundResult } from '../geometry/boolean-compound';
import { compoundRectangle } from '../geometry/boolean-compound.test-fixture';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
} from '../scene';
import { compileJob } from './compile-job';
import { openFillContours, summarizeOpenFillContours } from './open-fill-contours';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { partitionSavePreflight } from '../../ui/app/save-preflight-policy';
import {
  selectedCloseableOpenFillContourCount,
  selectedOpenFillContourRepairSummary,
} from '../../ui/common/fill-diagnostics';
import { partitionEmitPreflight } from '../../ui/laser/start-job-readiness-policy';
import { closeOpenFillContoursActions } from '../../ui/state/close-open-fill-contours-actions';

describe('retained Boolean results at the open Fill repair boundary', () => {
  it.each([true, false])(
    'keeps an open derived result advisory and nonrepairable with canonical curves=%s',
    (canonical) => {
      const derived = retainedOpenResult(canonical);
      const project = projectFor(derived);
      const groups = openFillContours(project.scene);

      expect(groups).toHaveLength(1);
      expect(groups[0]?.contourIndexes).toEqual([0]);
      expect(groups[0]?.repairable).toBe(false);
      expect(summarizeOpenFillContours(groups)).toEqual({
        objectIds: [derived.id],
        contourCount: 1,
      });
      expect(selectedCloseableOpenFillContourCount(project, derived.id, new Set())).toBe(0);
      expect(selectedOpenFillContourRepairSummary(project, derived.id, new Set(), 5)).toEqual({
        openCount: 1,
        safeCount: 0,
        reviewedCount: 0,
        remainingCount: 1,
      });
      const emitted = emitGcode(project);
      const issues = emitted.preflight.issues.filter(
        (issue) => issue.code === 'offset-fill-open-contour',
      );
      expect(emitted.gcode).toMatch(/^G1 /m);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toContain('1 open contour in 1 artwork');
      expect(partitionEmitPreflight(emitted.preflight).blocking).toHaveLength(0);
      expect(partitionEmitPreflight(emitted.preflight).warnings).toContain(issues[0]?.message);
      expect(partitionSavePreflight(emitted.preflight.issues).blocking).toHaveLength(0);
      expect(partitionSavePreflight(emitted.preflight.issues).advisories).toContainEqual(issues[0]);
    },
  );

  it.each(['default', 'reviewed'] as const)(
    'leaves retained operands, result and Undo unchanged under %s closure',
    (mode) => {
      const derived = retainedOpenResult();
      const project = projectFor(derived);
      const initialJson = JSON.stringify(project);
      const owner = closureOwner(project, [derived.id]);
      const operands = derived.booleanCompound?.operands;
      const baseline = compileJob(project.scene, project.device);

      if (mode === 'default') owner.actions.closeSelectedOpenFillContours();
      else owner.actions.closeSelectedOpenFillContoursWithTolerance(5);

      expect(owner.current().project).toBe(project);
      expect(owner.current().project.scene.objects[0]).toBe(derived);
      expect(derived.booleanCompound?.operands).toBe(operands);
      expect(JSON.stringify(project)).toBe(initialJson);
      expect(compileJob(project.scene, project.device)).toEqual(baseline);
      expect(owner.current().undoStack).toHaveLength(0);
      expect(owner.current().redoStack).toHaveLength(0);
      expect(owner.current().dirty).toBe(false);
      expect(summarizeOpenFillContours(openFillContours(project.scene)).contourCount).toBe(1);
    },
  );

  it('repairs the expanded ordinary result with synchronized geometry and executable Fill', () => {
    const derived = retainedOpenResult();
    const expanded = expandBooleanCompound(derived);
    const project = projectFor(expanded);
    const baseline = fillSegments(project);
    const owner = closureOwner(project, [expanded.id]);
    expect(expanded.booleanCompound).toBeUndefined();
    expect(openFillContours(project.scene)[0]?.repairable).toBe(true);
    expect(selectedCloseableOpenFillContourCount(project, expanded.id, new Set())).toBe(1);

    owner.actions.closeSelectedOpenFillContours();

    const after = owner.current().project;
    const repaired = after.scene.objects[0] as ImportedSvg;
    expect(repaired.paths[0]?.curves?.[0]?.closed).toBe(true);
    expect(repaired.paths[0]?.polylines[0]?.closed).toBe(true);
    expect(repaired.paths[0]?.polylines[0]?.points.at(-1)).toEqual({ x: 10, y: 10 });
    expect(openFillContours(after.scene)).toEqual([]);
    expect(fillSegments(after).length).toBeGreaterThan(baseline.length);
    expect(fillSegments(after).some((segment) => segment.polyline.every((p) => p.x <= 20))).toBe(
      true,
    );
    expect(owner.current().undoStack).toEqual([project]);
    expect(owner.current().dirty).toBe(true);
    expect(derived.paths[0]?.curves?.[0]?.closed).toBe(false);
    expect(derived.booleanCompound).toBeDefined();
  });

  it('repairs only ordinary selected artwork while retaining the compound omission', () => {
    const derived = retainedOpenResult();
    const ordinary = nearOpenArtwork('ordinary');
    const project = projectFor(derived, ordinary);
    const owner = closureOwner(project, [derived.id, ordinary.id]);
    expect(summarizeOpenFillContours(openFillContours(project.scene)).contourCount).toBe(2);
    expect(selectedCloseableOpenFillContourCount(project, derived.id, new Set([ordinary.id]))).toBe(
      1,
    );

    owner.actions.closeSelectedOpenFillContours();

    const after = owner.current().project;
    expect(after.scene.objects[0]).toBe(derived);
    expect((after.scene.objects[1] as ImportedSvg).paths[0]?.curves?.[0]?.closed).toBe(true);
    expect(summarizeOpenFillContours(openFillContours(after.scene))).toEqual({
      objectIds: [derived.id],
      contourCount: 1,
    });
    expect(openFillContours(after.scene)[0]?.repairable).toBe(false);
    expect(owner.current().undoStack).toEqual([project]);
  });
});

function retainedOpenResult(canonical = true): ImportedSvg {
  // Deliberately model an open derived-cache sentinel. Retained closed operands,
  // not these cached paths, remain authoritative until explicit expansion.
  const retained = retainBooleanCompoundResult(
    nearOpenArtwork('compound', canonical),
    'subtract',
    [compoundRectangle('subject', 0, 'fill'), compoundRectangle('clip', 5, 'fill')],
    true,
  );
  if (retained.kind !== 'ok') throw new Error('Expected captured compound sources');
  return retained.value;
}

function nearOpenArtwork(id: string, canonical = true): ImportedSvg {
  const points = [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
    { x: 10, y: 20 },
    { x: 10, y: 10.2 },
  ];
  const curve: CurveSubpath = {
    start: points[0]!,
    closed: false,
    segments: points.slice(1).map((to) => ({ kind: 'line', to })),
  };
  return {
    kind: 'imported-svg',
    id,
    source: id + '.svg',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
    operationIds: ['fill'],
    paths: [
      {
        color: '#000000',
        polylines: [{ closed: false, points }],
        ...(canonical ? { curves: [curve] } : {}),
      },
    ],
  };
}

function projectFor(...objects: ReadonlyArray<ImportedSvg>): Project {
  return {
    ...createProject(),
    scene: {
      objects: [...objects, compoundRectangle('closed-control', 30, 'fill')],
      layers: [createLayer({ id: 'fill', color: '#000000', mode: 'fill' })],
    },
  };
}

function closureOwner(project: Project, selectedIds: ReadonlyArray<string>) {
  let state = {
    project,
    undoStack: [] as ReadonlyArray<Project>,
    redoStack: [] as ReadonlyArray<Project>,
    dirty: false,
    selectedObjectId: selectedIds[0] ?? null,
    additionalSelectedIds: new Set(selectedIds.slice(1)),
  };
  const actions = closeOpenFillContoursActions((update) => {
    state = { ...state, ...update(state) };
  });
  return { actions, current: () => state };
}

function fillSegments(project: Project) {
  return compileJob(project.scene, project.device).groups.flatMap((group) =>
    group.kind === 'fill' ? group.segments : [],
  );
}
