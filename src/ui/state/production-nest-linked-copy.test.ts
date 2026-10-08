import { describe, expect, it } from 'vitest';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { createBlankReliefAuthoringDocument } from '../../core/relief/relief-authoring-document';
import { materializeReliefAuthoring } from '../../core/relief/materialize-relief-authoring';
import {
  IDENTITY_TRANSFORM,
  DEFAULT_CNC_LAYER_SETTINGS,
  createLayer,
  type Project,
} from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import { deserializeProject } from '../../io/project';
import { planProductionNest } from '../../core/nesting/production-nest-plan';
import { prepareProductionNest } from './prepare-production-nest';
import { materializeProductionSheets } from './production-nest-sheet-materialize';
import {
  productionDefinitionFixture,
  productionProjectFixture,
} from './production-nest.test-fixture';
import {
  productionLinkedDependencyIds,
  remapProductionReliefLinks,
} from './production-nest-linked-copy';

function linkedProject(): Project {
  const base = productionProjectFixture();
  const document = {
    ...createBlankReliefAuthoringDocument({
      width: 2,
      height: 2,
      physicalWidthMm: 10,
      physicalHeightMm: 10,
      maxDepthMm: 1,
    }),
    clip: {
      rings: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      ],
      linkedObjectId: 'cutout',
    },
  };
  const sampled = materializeReliefAuthoring(document);
  if (sampled.kind !== 'ok') throw new Error('Failed relief fixture');
  const relief: HeightfieldReliefObject = {
    kind: 'relief',
    id: 'surface',
    source: 'surface.map',
    reliefSource: sampled.field,
    reliefAuthoring: document,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#a0522d',
    operationIds: [],
    targetWidthMm: 10,
    reliefDepthMm: 1,
  };
  const operation = {
    ...createLayer({ id: 'projected', color: '#000000' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'engrave' as const,
      reliefProjection: {
        reliefObjectId: relief.id,
        depthMm: 0.1,
        depthConvention: 'vertical' as const,
        sampleSpacingMm: 1,
      },
    },
  };
  return {
    ...base,
    cncSetup: {
      ...defaultCncMachiningSetup(),
      twoSided: {
        activeSide: 'A',
        flipAxis: 'x',
        sideBStockOriginMm: { x: 0, y: 0 },
        sideAObjectIds: ['source'],
        sideBObjectIds: ['cutout'],
        registration: [],
      },
    },
    scene: {
      ...base.scene,
      objects: [
        ...base.scene.objects.map((object) =>
          object.id === 'source'
            ? {
                ...object,
                operationIds: [...(object.operationIds ?? []), operation.id],
                ...('paths' in object
                  ? {
                      paths: object.paths.map((path) => ({
                        ...path,
                        operationIds: [
                          ...(path.operationIds ?? object.operationIds ?? []),
                          operation.id,
                        ],
                      })),
                    }
                  : {}),
              }
            : object,
        ),
        relief,
      ],
      layers: [...base.scene.layers, operation],
    },
  };
}

describe('production nesting linked setups and relief copies', () => {
  it('maps side assignments and projection layers to each output sheet’s own copied relief and artwork', () => {
    const project = linkedProject();
    const prepared = prepareProductionNest(project, productionDefinitionFixture());
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    expect(prepared.value.units[0]?.objects.some((object) => object.id === 'surface')).toBe(true);
    const result = materializeProductionSheets(
      prepared.value,
      planProductionNest(prepared.value.input),
      false,
    );
    if (result.kind !== 'ok') throw new Error(result.reason);
    for (const archive of result.value.sheetBook!.inactive) {
      const loaded = deserializeProject(archive.projectJson);
      if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
      const output = loaded.project;
      verifyLinkedOutput(output);
    }
    expect(result.value.scene).toBe(project.scene);
  });
  it('creates distinct reopenable projected operations when multiple copies share one sheet', () => {
    const project = linkedProject();
    const definition = productionDefinitionFixture();
    const stock = definition.sheets[0];
    if (stock === undefined) throw new Error('Missing stock');
    const prepared = prepareProductionNest(project, {
      ...definition,
      sheets: [{ ...stock, widthMm: 46, heightMm: 26 }],
    });
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    const result = materializeProductionSheets(
      prepared.value,
      planProductionNest(prepared.value.input),
      false,
    );
    if (result.kind !== 'ok') throw new Error(result.reason);
    const archive = result.value.sheetBook?.inactive[0];
    if (archive === undefined) throw new Error('Missing generated archive');
    const loaded = deserializeProject(archive.projectJson);
    if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
    verifySharedProjectionCopies(loaded.project);
  });
  it('finds and remaps vector boundaries, open rails, masks and stroke regions without carrying source IDs', () => {
    const project = linkedProject();
    const relief = project.scene.objects.find(
      (object) => object.kind === 'relief',
    ) as HeightfieldReliefObject;
    const document = relief.reliefAuthoring!;
    const mask = document.clip!;
    const rail = {
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      linkedObjectId: 'rail',
    };
    const source = {
      kind: 'rail-profile-v1' as const,
      rail,
      secondRail: { ...rail, linkedObjectId: 'rail-2' },
      widthMm: 2,
      samplingSteps: 2,
      sections: [],
    };
    const object = {
      ...relief,
      reliefAuthoring: {
        ...document,
        levels: [{ ...document.levels[0]!, mask }],
        components: [
          {
            id: 'component',
            name: 'Rail',
            levelId: 'level-1',
            visible: true,
            combineMode: 'replace' as const,
            transform: IDENTITY_TRANSFORM,
            baseHeightMm: 0,
            heightScale: 1,
            mask,
            source,
          },
        ],
        strokes: [
          {
            schemaVersion: 1 as const,
            id: 'stroke',
            componentId: 'component',
            mode: 'add' as const,
            points: [],
            diameterMm: 1,
            strength: 1,
            flattenHeightMm: 0,
            region: mask,
          },
        ],
      },
    };
    expect(productionLinkedDependencyIds(project, object)).toEqual(['cutout', 'rail', 'rail-2']);
    const copied = remapProductionReliefLinks(
      object,
      new Map([
        ['cutout', 'local-boundary'],
        ['rail', 'local-rail'],
        ['rail-2', 'local-second'],
      ]),
    );
    const local = copied as HeightfieldReliefObject;
    expect(productionLinkedDependencyIds(project, local)).toEqual([
      'local-boundary',
      'local-rail',
      'local-second',
    ]);
    expect(local.reliefAuthoring?.strokes[0]?.region?.linkedObjectId).toBe('local-boundary');
  });
});

function verifyLinkedOutput(output: Project): void {
  const source = output.scene.objects.find((object) => object.name === 'Lettering')!;
  const boundary = output.scene.objects.find((object) => object.name === 'Outer boundary')!;
  const relief = output.scene.objects.find((object) => object.kind === 'relief')!;
  expect(output.cncSetup?.twoSided?.sideAObjectIds).toEqual([source.id]);
  expect(output.cncSetup?.twoSided?.sideBObjectIds).toEqual([boundary.id]);
  expect(
    'reliefAuthoring' in relief ? relief.reliefAuthoring?.clip?.linkedObjectId : undefined,
  ).toBe(boundary.id);
  const projection = output.scene.layers.find(
    (layer) => source.operationIds?.includes(layer.id) && layer.cnc?.reliefProjection !== undefined,
  )!;
  expect(projection.id).not.toBe('projected');
  expect(projection.cnc?.reliefProjection?.reliefObjectId).toBe(relief.id);
}

function verifySharedProjectionCopies(output: Project): void {
  expect(output.productionNest?.output?.instances).toHaveLength(2);
  const projections = output.scene.layers.filter(
    (layer) => layer.cnc?.reliefProjection !== undefined,
  );
  expect(projections).toHaveLength(2);
  expect(new Set(output.scene.layers.map((layer) => layer.color)).size).toBe(
    output.scene.layers.length,
  );
  expect(
    new Set(projections.map((layer) => layer.cnc?.reliefProjection?.reliefObjectId)).size,
  ).toBe(2);
  expect(output.cncSetup?.twoSided?.sideAObjectIds).toHaveLength(2);
  expect(output.cncSetup?.twoSided?.sideBObjectIds).toHaveLength(2);
  for (const layer of projections)
    expect(
      output.scene.objects.some(
        (object) => object.id === layer.cnc?.reliefProjection?.reliefObjectId,
      ),
    ).toBe(true);
}
