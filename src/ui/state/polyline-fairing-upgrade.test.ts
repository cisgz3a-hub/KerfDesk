import { describe, expect, it } from 'vitest';
import {
  createPolyline,
  CURRENT_POLYLINE_FAIRING_VERSION,
  polylineToPolylines,
} from '../../core/shapes';
import {
  captureLayerOperationSettings,
  createLayer,
  createProject,
  polylineToCurveSubpath,
  type PathSegment,
  type Project,
  type ShapeObject,
  type Vec2,
} from '../../core/scene';
import { compileJob } from '../../core/job';
import { deserializeProject, serializeProject } from '../../io/project';
import { fitLegacyCentripetalCubics } from '../../core/trace/centerline/curve-cubics';
import { upgradeProjectPolylineFairing } from './polyline-fairing-upgrade';

describe('upgradeProjectPolylineFairing', () => {
  it.each([false, true])(
    'preserves migrated operation output while fairing a v2 drawing (sub-operation: %s)',
    (withSubOperation) => {
      const legacy = legacyPolyline(alternatingBends(), false);
      const base = createLayer({ id: 'cut', color: '#000000' });
      const subLayers = withSubOperation
        ? [
            {
              id: 'finish',
              label: 'Finish',
              enabled: true,
              settings: { ...captureLayerOperationSettings(base), speed: 400 },
            },
          ]
        : [];
      const loaded = deserializeProject(
        JSON.stringify({
          ...projectWith(legacy),
          schemaVersion: 2,
          scene: {
            objects: [
              {
                ...legacy,
                powerScale: 100,
                operationOverride: { power: 17, speed: 600, passes: 3 },
                paths: legacy.paths.map((path) => ({ ...path, strokeWidthMm: 0.4 })),
              },
            ],
            layers: [{ ...base, subLayers }],
          },
        }),
      );
      if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
      const before = loaded.project;
      const facts = (project: Project) =>
        compileJob(project.scene, project.device)
          .groups.filter((group) => group.kind !== 'cnc')
          .map((group) => ({
            id: group.layerId,
            power: group.power,
            speed: group.speed,
            passes: group.passes,
          }));
      expect(facts(before)).toHaveLength(withSubOperation ? 2 : 1);
      expect(
        facts(before).every(
          (group) => group.power === 17 && group.speed === 600 && group.passes === 3,
        ),
      ).toBe(true);

      const result = upgradeProjectPolylineFairing(before);

      expect(result.upgradedCount).toBe(1);
      const upgraded = result.project.scene.objects[0];
      if (upgraded?.kind !== 'shape') throw new Error('Expected upgraded shape');
      expect(upgraded.paths[0]?.operationIds).toEqual(
        (before.scene.objects[0] as ShapeObject).paths[0]?.operationIds,
      );
      expect(upgraded.paths[0]?.strokeWidthMm).toBe(0.4);
      expect(facts(result.project)).toEqual(facts(before));
      expect(upgradeProjectPolylineFairing(result.project).project).toBe(result.project);
      const reopened = deserializeProject(serializeProject(result.project));
      if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
      expect(facts(reopened.project)).toEqual(facts(before));
    },
  );

  it('leaves extra authored path geometry intact when the pen spec cannot rematerialize it', () => {
    const legacy = legacyPolyline(alternatingBends(), false);
    const object = {
      ...legacy,
      paths: [...legacy.paths, { ...legacy.paths[0]!, operationIds: ['other'] }],
    };
    const project = projectWith(object);
    expect(upgradeProjectPolylineFairing(project).project).toBe(project);
  });

  it('upgrades an existing line-only pen drawing without dropping object metadata', () => {
    const points = arcPoints();
    const legacy = legacyPolyline(points, false);
    const project = projectWith(legacy);

    const result = upgradeProjectPolylineFairing(project);
    const upgraded = result.project.scene.objects[0];

    expect(result.upgradedCount).toBe(1);
    expect(upgraded?.kind).toBe('shape');
    expect(upgraded?.locked).toBe(true);
    expect(upgraded?.powerScale).toBe(72);
    expect(upgraded?.operationOverride).toEqual({ mode: 'line', power: 18 });
    if (upgraded?.kind !== 'shape') throw new Error('Expected an upgraded shape.');
    expect(
      upgraded.paths[0]?.curves?.[0]?.segments.every((segment) => segment.kind === 'cubic'),
    ).toBe(true);
  });

  it('leaves already-faired drawings and deliberate low-vertex shapes unchanged', () => {
    const faired = createPolyline({
      id: 'faired',
      color: '#000000',
      spec: { points: arcPoints(), closed: false },
    });
    const triangle = legacyPolyline(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 10, y: 15 },
      ],
      true,
    );
    const project = projectWith(faired, triangle);

    const result = upgradeProjectPolylineFairing(project);

    expect(result.upgradedCount).toBe(0);
    expect(result.project).toBe(project);
  });

  it('refits cubic drawings produced by the previous corner-preserving adapter', () => {
    const points = alternatingBends();
    const previous = preMarker(
      createPolyline({
        id: 'previous-fairing',
        color: '#000000',
        spec: { points, closed: false },
        fairingMode: 'corner-preserving',
      }),
    );
    const project = projectWith(previous);

    const result = upgradeProjectPolylineFairing(project);
    const upgraded = result.project.scene.objects[0];

    expect(result.upgradedCount).toBe(1);
    if (upgraded?.kind !== 'shape') throw new Error('Expected an upgraded shape.');
    expect(upgraded.paths).toEqual(
      createPolyline({
        id: previous.id,
        color: previous.color,
        spec: { points, closed: false },
        transform: previous.transform,
      }).paths,
    );
    expect(upgraded.paths).not.toEqual(previous.paths);
    // The refit stamps the current version so future loads skip it (ADR-214).
    expect(upgraded.fairingVersion).toBe(CURRENT_POLYLINE_FAIRING_VERSION);
  });

  it('skips a drawing already stamped at the current fairing version', () => {
    // A born-marked drawing (createPolyline stamps the current version) must be
    // recognized by its stamp alone, never re-faired — even if its curves would
    // no longer match a re-derivation.
    const drawing = createPolyline({
      id: 'stamped',
      color: '#000000',
      spec: { points: alternatingBends(), closed: false },
    });
    expect(drawing.fairingVersion).toBe(CURRENT_POLYLINE_FAIRING_VERSION);
    const input = projectWith(drawing);

    const result = upgradeProjectPolylineFairing(input);

    expect(result.upgradedCount).toBe(0);
    expect(result.project).toBe(input);
  });

  it('refits drawings produced by the PR #194 per-chord adapter', () => {
    const points = alternatingBends();
    const current = createPolyline({
      id: 'previous-round-adapter',
      color: '#000000',
      spec: { points, closed: false },
    });
    const cubics = fitLegacyCentripetalCubics(points, false);
    const previous: ShapeObject = preMarker({
      ...current,
      paths: [
        {
          ...current.paths[0]!,
          curves: [
            {
              start: cubics[0]!.p0,
              closed: false,
              segments: cubics.map<PathSegment>((cubic) => ({
                kind: 'cubic',
                control1: cubic.p1,
                control2: cubic.p2,
                to: cubic.p3,
              })),
            },
          ],
        },
      ],
    });

    const result = upgradeProjectPolylineFairing(projectWith(previous));
    const upgraded = result.project.scene.objects[0];

    expect(result.upgradedCount).toBe(1);
    if (upgraded?.kind !== 'shape') throw new Error('Expected an upgraded shape.');
    expect(upgraded.paths).toEqual(current.paths);
    expect(upgraded.paths).not.toEqual(previous.paths);
  });
});

// A pre-marker drawing: real drawings saved before ADR-214 carry no
// fairingVersion, so the synthetic "legacy" fixtures must drop the field that
// createPolyline now stamps, or the migration would rightly skip them.
function preMarker(object: ShapeObject): ShapeObject {
  const { fairingVersion: _fairingVersion, ...rest } = object;
  return rest;
}

function legacyPolyline(points: ReadonlyArray<Vec2>, closed: boolean): ShapeObject {
  const spec = { points, closed };
  const polylines = polylineToPolylines(spec);
  const current = createPolyline({ id: `legacy-${closed}`, color: '#000000', spec });
  return preMarker({
    ...current,
    locked: true,
    powerScale: 72,
    operationOverride: { mode: 'line', power: 18 },
    paths: [{ color: '#000000', polylines, curves: polylines.map(polylineToCurveSubpath) }],
  });
}

function arcPoints(): Vec2[] {
  return Array.from({ length: 13 }, (_, index) => {
    const angle = (index / 12) * Math.PI;
    return { x: 50 + 50 * Math.cos(angle), y: 50 * Math.sin(angle) };
  });
}

function alternatingBends(): Vec2[] {
  return [
    { x: 0, y: 80 },
    { x: 30, y: 20 },
    { x: 60, y: 80 },
    { x: 90, y: 20 },
    { x: 120, y: 80 },
  ];
}

function projectWith(...objects: ReadonlyArray<ShapeObject>): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      objects,
      layers: [createLayer({ id: '#000000', color: '#000000' })],
    },
  };
}
