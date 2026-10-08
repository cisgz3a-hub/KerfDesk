import {
  captureBooleanCompound,
  evaluateBooleanCompound,
} from '../../core/geometry/boolean-compound';
import { compoundRectangle } from '../../core/geometry/boolean-compound.test-fixture';
import { createLayer, createProject, type ImportedSvg, type Project } from '../../core/scene';
import { createProductionManifest } from '../../core/scene/production-manifest';
import { serializeProject } from './serialize-project';

export const ARCHIVE_COMPOUND_LOCATIONS = [
  'inactive sheet',
  'production seed',
  'reviewed variant',
  'array source',
  'array baseline',
  'sheet production array source',
  'sheet reviewed array baseline',
] as const;
export type ArchiveCompoundLocation = (typeof ARCHIVE_COMPOUND_LOCATIONS)[number];

export function compoundArchiveProject(): Project {
  const captured = captureBooleanCompound('subtract', [
    compoundRectangle('subject'),
    compoundRectangle('clip', 5),
  ]);
  if (captured.kind !== 'ok') throw new Error(captured.error.message);
  const evaluated = evaluateBooleanCompound({
    ...compoundRectangle('compound'),
    booleanCompound: captured.value,
  });
  if (evaluated.kind !== 'ok') throw new Error(evaluated.error.message);
  return {
    ...createProject(),
    scene: {
      objects: [evaluated.value],
      // Scene artwork colour, not application chrome.
      layers: [createLayer({ id: 'cut', color: '#000000' })],
      groups: [],
      artworkOrder: ['compound'],
      designTreeOrder: [
        { kind: 'object', id: 'stale-but-ignorable' },
        { kind: 'object', id: 'compound' },
      ],
    },
  };
}

export function corruptArchiveCompound(kind: 'open source' | 'stale cache'): Project {
  const project = compoundArchiveProject();
  const original = project.scene.objects[0] as ImportedSvg;
  if (original.booleanCompound === undefined) throw new Error('Missing retained sources');
  const object: ImportedSvg =
    kind === 'stale cache'
      ? { ...original, bounds: { ...original.bounds, maxX: 500 } }
      : {
          ...original,
          booleanCompound: {
            ...original.booleanCompound,
            operands: original.booleanCompound.operands.map((operand, index) =>
              index !== 0
                ? operand
                : {
                    ...operand,
                    object: {
                      ...operand.object,
                      paths: operand.object.paths.map(({ curves: _curves, ...path }) => ({
                        ...path,
                        polylines: path.polylines.map((line) => ({ ...line, closed: false })),
                      })),
                    },
                  },
            ),
          },
        };
  return { ...project, scene: { ...project.scene, objects: [object] } };
}

export function archiveAt(location: ArchiveCompoundLocation, inner: Project): Project {
  switch (location) {
    case 'inactive sheet':
      return sheet(inner);
    case 'production seed':
      return production(inner);
    case 'reviewed variant':
      return production(compoundArchiveProject(), inner);
    case 'array source':
      return array(inner, compoundArchiveProject());
    case 'array baseline':
      return array(compoundArchiveProject(), inner);
    case 'sheet production array source':
      return sheet(production(array(inner, compoundArchiveProject())));
    case 'sheet reviewed array baseline':
      return sheet(production(compoundArchiveProject(), array(compoundArchiveProject(), inner)));
  }
}

function sheet(inner: Project): Project {
  return {
    ...createProject(),
    sheetBook: {
      activeId: 'active',
      activeName: 'Active',
      inactive: [{ id: 'inactive', name: 'Inactive', projectJson: serializeProject(inner) }],
    },
  };
}

function production(seed: Project, reviewed?: Project): Project {
  const design: Project = {
    ...seed,
    variables: {
      recordIndex: 0,
      serialValue: 10,
      advancement: 'manual',
      csv: { sourceName: 'names.csv', headers: ['name'], records: [['Ada']] },
    },
  };
  let id = 0;
  const manifest = createProductionManifest(design, {
    name: 'Compound run',
    count: 1,
    now: new Date('2026-10-07T00:00:00.000Z'),
    designProjectJson: serializeProject(design),
    idFactory: () => `run-${++id}`,
  });
  return {
    ...compoundArchiveProject(),
    productionManifest:
      reviewed === undefined
        ? manifest
        : {
            ...manifest,
            rows: manifest.rows.map((row) => ({
              ...row,
              status: 'reviewed',
              reviewedAt: manifest.frozenAt,
              reviewedProjectJson: serializeProject(reviewed),
            })),
          },
  };
}

function array(source: Project, baseline: Project): Project {
  return {
    ...compoundArchiveProject(),
    arrayLayouts: [
      {
        id: 'layout',
        name: 'One compound instance',
        spec: { kind: 'grid', rows: 1, columns: 1, spacingX: 0, spacingY: 0 },
        sourceIds: ['compound'],
        instances: [{ id: 'instance', sourceToObject: { compound: 'compound' } }],
        ownedObjectIds: ['compound'],
        sourceProjectJson: serializeProject(source),
        baselineProjectJson: serializeProject(baseline),
      },
    ],
  };
}
