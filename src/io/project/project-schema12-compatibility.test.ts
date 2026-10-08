import { PROJECT_SCHEMA_VERSION } from '../../core/scene/project';
import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  type TextObject,
  type Project,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';

const placement = {
  guideObjectId: 'guide',
  offsetMm: 2,
  reverse: true,
  alongAlign: 'end' as const,
  acrossAlign: 'below' as const,
};
const recipe = {
  toolId: 'finish',
  feedMmPerMin: 321,
  plungeMmPerMin: 123,
  spindleRpm: 9000,
  depthPerPassMm: 0.2,
};
const legacyPlacement = { guideObjectId: 'guide', offsetMm: 2, reverse: true };
const text: TextObject = {
  kind: 'text',
  id: 'text',
  content: 'Part',
  fontKey: 'roboto-regular',
  sizeMm: 10,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  color: '#000000',
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 10 },
          ],
        },
      ],
    },
  ],
};

describe('schema 12 unifies the two schema 11 feature branches', () => {
  it.each([
    { aligned: true, staged: false },
    { aligned: false, staged: true },
    { aligned: true, staged: true },
    { aligned: false, staged: false },
  ])(
    'keeps schema 11 alignment=$aligned and stage recipes=$staged through saving',
    ({ aligned, staged }) => {
      const base = createProject();
      const raw = {
        ...base,
        schemaVersion: 11,
        scene: {
          ...base.scene,
          objects: [{ ...text, pathText: aligned ? placement : legacyPlacement }],
          layers: [
            {
              ...createLayer({ id: 'cut', color: '#000000' }),
              cnc: {
                ...DEFAULT_CNC_LAYER_SETTINGS,
                ...(staged ? { stageRecipes: { 'relief-finish': recipe } } : {}),
              },
            },
          ],
        },
      };
      const loaded = readProject(JSON.stringify(raw));
      verifySettings(loaded, aligned, staged);
      const saved = prepareProjectForPersistence(loaded);
      if (saved.kind !== 'ok') throw new Error(saved.reason);
      expect(JSON.parse(saved.json).schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
      const reopened = readProject(saved.json);
      verifySettings(reopened, aligned, staged);
      if (!aligned) {
        const object = reopened.scene.objects[0];
        expect(object?.kind === 'text' ? object.pathText?.alongAlign : null).toBeUndefined();
        expect(object?.kind === 'text' ? object.pathText?.acrossAlign : null).toBeUndefined();
      }
    },
  );
});

function readProject(json: string): Project {
  const loaded = deserializeProject(json);
  if (loaded.kind !== 'ok') throw new Error('Project did not load');
  return loaded.project;
}

function verifySettings(project: Project, aligned: boolean, staged: boolean): void {
  expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  expect(project.scene.objects[0]).toMatchObject({
    pathText: aligned ? placement : legacyPlacement,
  });
  expect(project.scene.layers[0]?.cnc?.stageRecipes).toEqual(
    staged ? { 'relief-finish': recipe } : undefined,
  );
}
