// Audit 28-P2-1: "Add reviewed design" must give its operation the operator's
// own setup, like every other way to add artwork: Make Default, the job
// material's best recipe (ADR-496 decision 4) and, on CNC, the machine
// starter or stock material (ADR-416 decision 2). Each case adds the same
// kind of artwork by every path in a fresh store and compares the results.

import { beforeEach, describe, expect, it } from 'vitest';
import type { AiDraft, AiRequest } from '../../core/ai/assistant';
import { generateBox } from '../../core/box';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { captureMaterialRecipe } from '../../core/material-library';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  type Layer,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { aiDraftArtwork, applyAiDraft } from './ai-artwork';

const ARTWORK_COLOR = '#000000';
// A new operation's built-in values, for the fields a case does not set.
const PLAIN = createLayer({ id: 'plain', color: ARTWORK_COLOR });

const REQUEST: AiRequest = {
  task: 'vector',
  prompt: 'A 20 mm square outline',
  widthMm: 20,
  heightMm: 20,
  photo: null,
  candidates: [],
};

const DRAFT: AiDraft = {
  title: 'Square outline',
  explanation: 'A closed square.',
  paths: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
        { x: 0, y: 0 },
      ],
    },
  ],
  matches: [],
};

const LIBRARY: MaterialLibraryDocument = {
  format: MATERIAL_LIBRARY_FORMAT,
  librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
  libraryId: 'shop',
  name: 'Shop',
  entries: [
    {
      id: 'birch-cut',
      materialName: 'Birch plywood',
      thicknessMm: 3,
      description: 'Cut through',
      operation: 'cut',
      revision: 'rev-1',
      recipe: captureMaterialRecipe({
        ...createLayer({ id: 'birch-cut', color: ARTWORK_COLOR, mode: 'line' }),
        power: 85,
        speed: 350,
        passes: 3,
      }),
    },
  ],
};

function operationOf(objectId: string): Layer {
  const scene = useStore.getState().project.scene;
  const object = scene.objects.find((candidate) => candidate.id === objectId);
  const operation = object === undefined ? null : primaryOperationForObject(object, scene.layers);
  if (operation === null) throw new Error(`no operation for ${objectId}`);
  return operation;
}

function addAiDraft(): Layer {
  const state = useStore.getState();
  const owner = { project: state.project, epoch: state.projectDocumentEpoch };
  const object = aiDraftArtwork(DRAFT, REQUEST, 'ai-draft');
  useStore.setState((current) => applyAiDraft(current, owner, object));
  return operationOf('ai-draft');
}

function drawRectangle(): Layer {
  useStore.getState().drawShape(
    createRectangle({
      id: 'drawn',
      color: ARTWORK_COLOR,
      spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 5, y: 5 },
    }),
  );
  return operationOf('drawn');
}

function importSvg(): Layer {
  useStore.getState().importSvgObject(svgObj('imported', [ARTWORK_COLOR]));
  return operationOf('imported');
}

function insertBox(): Layer {
  const box = generateBox({
    widthMm: 60,
    depthMm: 40,
    heightMm: 30,
    dimensionMode: 'inner',
    thicknessMm: 3,
    targetFingerWidthMm: 9,
    style: 'closed',
    clearanceMm: 0,
    relief: { kind: 'none' },
    partSpacingMm: 8,
  });
  if (box.kind !== 'generated') throw new Error(box.kind);
  useStore.getState().insertBoxPanels(box.panels, { thicknessMm: 3 });
  const panel = useStore.getState().selectedObjectId;
  if (panel === null) throw new Error('no box panel');
  return operationOf(panel);
}

const ADD_PATHS: ReadonlyArray<readonly [string, () => Layer]> = [
  ['drawn shape', drawRectangle],
  ['imported SVG', importSvg],
  ['box panels', insertBox],
  ['AI draft', addAiDraft],
];

function seededByEveryPath<T>(setup: () => void, summary: (layer: Layer) => T): Map<string, T> {
  return new Map(
    ADD_PATHS.map(([name, add]) => {
      resetStore();
      setup();
      return [name, summary(add())] as const;
    }),
  );
}

function expectEveryPathLike<T>(seeded: Map<string, T>, expected: T): void {
  for (const [name, settings] of seeded)
    expect({ name, settings }).toEqual({ name, settings: expected });
}

function laserSummary(layer: Layer) {
  return {
    mode: layer.mode,
    power: layer.power,
    speed: layer.speed,
    passes: layer.passes,
    airAssist: layer.airAssist,
    presetId: layer.materialBinding?.presetId,
  };
}

function cncSummary(layer: Layer) {
  const cnc = layer.cnc;
  return {
    toolId: cnc?.toolId,
    feedMmPerMin: cnc?.feedMmPerMin,
    plungeMmPerMin: cnc?.plungeMmPerMin,
    depthPerPassMm: cnc?.depthPerPassMm,
    feedSource: cnc?.feedSource?.kind,
  };
}

beforeEach(resetStore);

describe('AI drafts take the same new-operation setup as every other add path', () => {
  it('links the job material’s best recipe', () => {
    const seeded = seededByEveryPath(() => {
      useStore.getState().setMaterialLibrary(LIBRARY);
      useStore.getState().setJobLaserMaterial({
        name: 'Birch plywood',
        thicknessMm: 3,
        autoApplyRecipes: true,
      });
    }, laserSummary);

    expectEveryPathLike(seeded, {
      mode: 'line',
      power: 85,
      speed: 350,
      passes: 3,
      airAssist: PLAIN.airAssist,
      presetId: 'birch-cut',
    });
  });

  it('takes Make Default for all colours', () => {
    const seeded = seededByEveryPath(() => {
      const source = {
        ...createLayer({ id: 'source', color: '#ff00ff' }),
        power: 12,
        speed: 600,
        airAssist: true,
      };
      const project = useStore.getState().project;
      useStore.setState({
        project: { ...project, scene: { ...project.scene, layers: [source] } },
      });
      useStore.getState().makeLayerDefaultForAll(source.id);
    }, laserSummary);

    expectEveryPathLike(seeded, {
      mode: 'line',
      power: 12,
      speed: 600,
      passes: PLAIN.passes,
      airAssist: true,
      presetId: undefined,
    });
  });

  it('takes the 4040 machine starter on CNC', () => {
    const seeded = seededByEveryPath(() => {
      useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
      useStore.getState().setMachineKind('cnc');
    }, cncSummary);

    expectEveryPathLike(seeded, {
      toolId: 'em-3175',
      feedMmPerMin: 300,
      plungeMmPerMin: 250,
      depthPerPassMm: 0.75,
      feedSource: 'machine-starter',
    });
  });
});
