import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job';
import {
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  IDENTITY_TRANSFORM,
  sceneLayerVisibility,
  type ColoredPath,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../../core/scene';
import { planWeldSelection } from './vector-path-weld-plan';

function rectangle(color: string, operationIds: ReadonlyArray<string>, x: number): ColoredPath {
  return {
    color,
    operationIds,
    polylines: [
      {
        closed: true,
        points: [
          { x, y: 0 },
          { x: x + 10, y: 0 },
          { x: x + 10, y: 10 },
          { x, y: 10 },
          { x, y: 0 },
        ],
      },
    ],
  };
}

function artwork(
  id: string,
  paths: ReadonlyArray<ColoredPath>,
  metadata: Partial<ImportedSvg> = {},
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths,
    ...metadata,
  };
}

function scene(objects: ReadonlyArray<ImportedSvg>, layers: ReadonlyArray<Layer>): Scene {
  return { objects, layers, groups: [], artworkOrder: objects.map((object) => object.id) };
}

function unwrap(result: ReturnType<typeof planWeldSelection>) {
  if (result.kind === 'error') throw new Error(result.error.message);
  return result.value;
}

describe('planWeldSelection', () => {
  it('preserves distinct line/fill operations and exact effective output', () => {
    const red = {
      ...createLayer({ id: 'red', name: 'Red line', color: '#ff0000' }),
      power: 10,
      speed: 100,
    };
    const blue = {
      ...createLayer({ id: 'blue', name: 'Blue fill', color: '#0000ff', mode: 'fill' }),
      power: 90,
      speed: 900,
      hatchSpacingMm: 1,
    };
    const redObject = artwork('red-object', [rectangle('#ff0000', ['red'], 0)]);
    const blueObject = artwork('blue-object', [rectangle('#0000ff', ['blue'], 20)]);
    const plan = unwrap(
      planWeldSelection(
        scene([redObject, blueObject], [red, blue]),
        [redObject, blueObject],
        'welded',
      ),
    );
    const operationIds = plan.object.paths.flatMap((path) => path.operationIds ?? []);
    const cloned = plan.layers.filter((layer) => operationIds.includes(layer.id));

    expect(
      cloned.map((layer) => ({ mode: layer.mode, power: layer.power, speed: layer.speed })),
    ).toEqual([
      { mode: 'line', power: 10, speed: 100 },
      { mode: 'fill', power: 90, speed: 900 },
    ]);
    expect(plan.object.paths.map((path) => path.operationIds)).toEqual([
      [cloned[0]!.id],
      [cloned[1]!.id],
    ]);

    const job = compileJob(scene([plan.object], cloned), DEFAULT_DEVICE_PROFILE);
    expect(
      job.groups.map((group) =>
        group.kind === 'cut' || group.kind === 'fill'
          ? { kind: group.kind, power: group.power, speed: group.speed }
          : { kind: group.kind },
      ),
    ).toEqual([
      { kind: 'cut', power: 10, speed: 100 },
      { kind: 'fill', power: 90, speed: 900 },
    ]);
  });

  it('bakes override and power scale once instead of falling back to the source layer', () => {
    const base = {
      ...createLayer({ id: 'base', name: 'Base', color: '#ff0000' }),
      power: 10,
      speed: 100,
    };
    const source = artwork('subject', [rectangle('#ff0000', ['base'], 0)], {
      powerScale: 25,
      operationOverride: { mode: 'fill', power: 90, speed: 321, passes: 3, airAssist: true },
    });
    const plan = unwrap(planWeldSelection(scene([source], [base]), [source], 'welded'));
    const operationId = plan.object.paths[0]?.operationIds?.[0];
    const clone = plan.layers.find((layer) => layer.id === operationId);

    expect(plan.object.powerScale).toBeUndefined();
    expect(plan.object.operationOverride).toBeUndefined();
    expect(clone).toMatchObject({
      mode: 'fill',
      power: 22.5,
      speed: 321,
      passes: 3,
      airAssist: true,
    });
    const group = compileJob(
      scene([plan.object], clone === undefined ? [] : [clone]),
      DEFAULT_DEVICE_PROFILE,
    ).groups[0];
    expect(group).toMatchObject({
      kind: 'fill',
      power: 22.5,
      speed: 321,
      passes: 3,
      airAssist: true,
    });
  });

  it('bakes override and power scale into every cloned sublayer and breaks stale links', () => {
    const rootBase = {
      ...createLayer({ id: 'root', name: 'Root', color: '#ff0000' }),
      power: 20,
      speed: 200,
    };
    const root: Layer = {
      ...rootBase,
      materialBinding: {
        libraryId: 'library',
        presetId: 'preset',
        presetRevision: 'rev-1',
        lastResolved: captureLayerOperationSettings(rootBase),
      },
    };
    const withSubLayer: Layer = {
      ...root,
      subLayers: [
        createLayerSubLayer(root, {
          id: 'sub-1',
          label: 'Detail',
          settings: captureLayerOperationSettings({ ...root, power: 40, speed: 400 }),
        }),
      ],
    };
    const source = artwork('subject', [rectangle('#ff0000', ['root'], 0)], {
      powerScale: 50,
      operationOverride: { power: 80, speed: 500 },
    });
    const plan = unwrap(planWeldSelection(scene([source], [withSubLayer]), [source], 'welded'));
    const operationId = plan.object.paths[0]?.operationIds?.[0];
    const clone = plan.layers.find((layer) => layer.id === operationId);

    expect(clone).toMatchObject({ power: 40, speed: 500 });
    expect(clone?.subLayers[0]?.settings).toMatchObject({ power: 40, speed: 500 });
    expect(clone?.materialBinding).toBeUndefined();
    expect(clone?.subLayers).not.toBe(withSubLayer.subLayers);
    expect(clone?.subLayers[0]?.settings).not.toBe(withSubLayer.subLayers[0]?.settings);
  });

  it('splits one source operation when selected objects have different effective metadata', () => {
    const base = { ...createLayer({ id: 'base', color: '#ff0000' }), power: 80 };
    const low = artwork('low', [rectangle('#ff0000', ['base'], 0)], { powerScale: 25 });
    const high = artwork('high', [rectangle('#ff0000', ['base'], 20)], { powerScale: 75 });
    const plan = unwrap(planWeldSelection(scene([low, high], [base]), [low, high], 'welded'));
    const operationIds = plan.object.paths.flatMap((path) => path.operationIds ?? []);
    const clones = plan.layers.filter((layer) => operationIds.includes(layer.id));

    expect(clones.map((layer) => layer.power)).toEqual([20, 60]);
    expect(new Set(operationIds).size).toBe(2);
  });

  it('reuses unchanged operations and keeps unmatched paths explicitly non-output', () => {
    const blue = {
      ...createLayer({ id: 'blue', name: 'Blue', color: '#0000ff' }),
      power: 90,
      speed: 900,
    };
    const source = artwork('mixed-output', [
      rectangle('#ff0000', [], 0),
      rectangle('#0000ff', ['blue'], 20),
    ]);

    const plan = unwrap(planWeldSelection(scene([source], [blue]), [source], 'welded'));

    expect(plan.layers).toEqual([blue]);
    expect(plan.object.paths.map((path) => path.operationIds)).toEqual([[], ['blue']]);
    const job = compileJob(scene([plan.object], plan.layers), DEFAULT_DEVICE_PROFILE);
    expect(job.groups).toHaveLength(1);
    expect(job.groups[0]?.layerId).toBe('blue');
    expect(
      job.groups
        .flatMap((group) =>
          group.kind === 'cut' || group.kind === 'fill'
            ? group.segments.flatMap((segment) => segment.polyline)
            : [],
        )
        .reduce((minX, point) => Math.min(minX, point.x), Number.POSITIVE_INFINITY),
    ).toBe(20);
  });

  it('preserves orphan ownership and gives legacy unassigned paths fail-visible identities', () => {
    const blue = createLayer({ id: 'blue', color: '#0000ff' });
    const source = artwork(
      'mixed-orphans',
      [
        rectangle('#ff0000', ['orphan-welded-1'], 0),
        legacyRectangle('#00ff00', 10),
        rectangle('#0000ff', ['blue', 'missing-partial'], 20),
      ],
      { operationIds: ['missing-object'] },
    );
    const legacy = artwork('legacy-unassigned', [legacyRectangle('#000000', 40)]);
    const plan = unwrap(
      planWeldSelection(scene([source, legacy], [blue]), [source, legacy], 'welded'),
    );
    const operationLookup = new Map(plan.layers.map((layer) => [layer.id, layer]));
    const bindings = plan.object.paths.map((path) => path.operationIds);

    expect(bindings).toContainEqual(['orphan-welded-1']);
    expect(bindings).toContainEqual(['orphan-welded-1-2']);
    expect(bindings).toContainEqual(['missing-object']);
    expect(bindings).toContainEqual(['missing-partial']);
    expect(bindings).toContainEqual(['blue']);
    for (const path of plan.object.paths.filter(
      (candidate) => candidate.operationIds?.[0] !== 'blue',
    )) {
      expect(sceneLayerVisibility.resolvePath(plan.object, path, operationLookup).visible).toBe(
        true,
      );
    }
    expect(
      compileJob(scene([plan.object], plan.layers), DEFAULT_DEVICE_PROFILE).groups,
    ).toHaveLength(1);
  });

  it('keeps source-owned paths linked while isolating a redundant persistent override', () => {
    const shared = {
      ...createLayer({ id: 'shared', color: '#ff0000' }),
      power: 30,
      speed: 1500,
    };
    const overridden = artwork('overridden', [rectangle('#ff0000', ['shared'], 0)], {
      operationOverride: { power: 30 },
    });
    const inherited = artwork('inherited', [rectangle('#ff0000', ['shared'], 20)]);
    const plan = unwrap(
      planWeldSelection(
        scene([overridden, inherited], [shared]),
        [overridden, inherited],
        'welded',
      ),
    );
    const isolatedId = plan.object.paths
      .flatMap((path) => path.operationIds ?? [])
      .find((operationId) => operationId !== 'shared');
    const editedLayers = plan.layers.map((layer) =>
      layer.id === 'shared' ? { ...layer, power: 70 } : layer,
    );
    const groups = compileJob(scene([plan.object], editedLayers), DEFAULT_DEVICE_PROFILE).groups;
    const powerByMinX = groups
      .flatMap((group) =>
        group.kind === 'cut' || group.kind === 'fill'
          ? [
              {
                power: group.power,
                minX: group.segments
                  .flatMap((segment) => segment.polyline)
                  .reduce((value, point) => Math.min(value, point.x), Number.POSITIVE_INFINITY),
              },
            ]
          : [],
      )
      .sort((left, right) => left.minX - right.minX);

    expect(isolatedId).toBeDefined();
    expect(plan.object.paths.map((path) => path.operationIds)).toContainEqual(['shared']);
    expect(powerByMinX).toEqual([
      { power: 30, minX: 0 },
      { power: 70, minX: 20 },
    ]);
  });

  for (const orphanSelected of [false, true]) {
    it(`does not activate a ${orphanSelected ? 'selected' : 'unselected'} colliding orphan binding`, () => {
      const base = createLayer({ id: 'base', color: '#ff0000' });
      const scaled = artwork('scaled', [rectangle('#ff0000', ['base'], 0)], { powerScale: 50 });
      const orphan = artwork('orphan', [rectangle('#0000ff', ['operation-welded'], 30)]);
      const legacy = artwork('legacy', [legacyRectangle('#000000', 50)]);
      const allObjects = [scaled, orphan, legacy];
      const selectedObjects = orphanSelected ? [scaled, orphan] : [scaled];
      const plan = unwrap(planWeldSelection(scene(allObjects, [base]), selectedObjects, 'welded'));
      const finalObjects = orphanSelected ? [plan.object, legacy] : [plan.object, orphan, legacy];
      const emittedPoints = compileJob(
        scene(finalObjects, plan.layers),
        DEFAULT_DEVICE_PROFILE,
      ).groups.flatMap((group) =>
        group.kind === 'cut' || group.kind === 'fill'
          ? group.segments.flatMap((segment) => segment.polyline)
          : [],
      );

      expect(plan.layers.map((layer) => layer.id)).not.toContain('operation-welded');
      expect(plan.layers.find((layer) => layer.id !== 'base')?.color).not.toBe('#000000');
      if (orphanSelected) {
        expect(plan.object.paths.map((path) => path.operationIds)).toContainEqual([
          'operation-welded',
        ]);
      }
      expect(emittedPoints.reduce((maxX, point) => Math.max(maxX, point.x), 0)).toBe(10);
    });
  }

  for (const legacySelected of [false, true]) {
    it(`isolates output without duplicating ${legacySelected ? 'selected' : 'unselected'} same-color legacy artwork`, () => {
      const base = {
        ...createLayer({ id: 'base', color: '#ff0000' }),
        power: 60,
      };
      const scaled = artwork('scaled', [rectangle('#ff0000', ['base'], 0)], { powerScale: 50 });
      const legacy = artwork('same-color-legacy', [legacyRectangle('#ff0000', 30)]);
      const selected = legacySelected ? [scaled, legacy] : [scaled];
      const plan = unwrap(planWeldSelection(scene([scaled, legacy], [base]), selected, 'welded'));
      const finalObjects = legacySelected ? [plan.object] : [plan.object, legacy];
      const groups = compileJob(
        scene(finalObjects, plan.layers),
        DEFAULT_DEVICE_PROFILE,
      ).groups.flatMap((group) =>
        group.kind === 'cut' || group.kind === 'fill'
          ? [
              {
                power: group.power,
                minX: group.segments
                  .flatMap((segment) => segment.polyline)
                  .reduce((value, point) => Math.min(value, point.x), Number.POSITIVE_INFINITY),
                maxX: group.segments
                  .flatMap((segment) => segment.polyline)
                  .reduce((value, point) => Math.max(value, point.x), Number.NEGATIVE_INFINITY),
              },
            ]
          : [],
      );

      expect(groups.sort((left, right) => left.minX - right.minX)).toEqual([
        { power: 30, minX: 0, maxX: 10 },
        { power: 60, minX: 30, maxX: 40 },
      ]);
    });
  }
});

function legacyRectangle(color: string, x: number): ColoredPath {
  const { operationIds: _operationIds, ...path } = rectangle(color, [], x);
  return path;
}
