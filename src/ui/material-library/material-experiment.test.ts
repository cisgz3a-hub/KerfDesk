import { beforeEach, describe, expect, it } from 'vitest';
import { recipeProject } from '../../core/material-library/process-recipe.test-fixture';
import {
  experimentBounds,
  photoCellAt,
  registeredCellPolygon,
  validRegistration,
} from '../../core/material-library/material-experiment';
import { deserializeMaterialLibrary, serializeMaterialLibrary } from '../../io/material-library';
import { parseMaterialExperiments } from '../../io/material-library/material-experiment-io';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { captureArtworkExperiment } from './capture-material-experiment';
import { testExperiment } from './material-experiment.test-fixture';

describe('portable material experiment workflow', () => {
  beforeEach(resetStore);
  it('captures actual per-cell power and clamped feed instead of row defaults', () => {
    const value = testExperiment();
    expect(value.cells.map((cell) => cell.requestedFeed)).toEqual([5000, 5000, 1000, 1000]);
    expect(value.cells.map((cell) => cell.effectiveFeed)).toEqual([3000, 3000, 1000, 1000]);
    expect(value.cells.map((cell) => cell.process.steps[0]?.settings.power)).toEqual([
      10, 40, 10, 40,
    ]);
    expect(value.cells.map((cell) => cell.process.steps[0]?.settings.speed)).toEqual([
      3000, 3000, 1000, 1000,
    ]);
  });
  it('perspective-picks exact cells, leaves gaps unselected and rejects crossed registration', () => {
    const value = {
      ...testExperiment(),
      photo: {
        dataUrl: 'data:image/png;base64,YQ==',
        width: 600,
        height: 400,
        registration: [
          { x: 0.1, y: 0.2 },
          { x: 0.9, y: 0.1 },
          { x: 0.8, y: 0.9 },
          { x: 0.2, y: 0.8 },
        ] as const,
      },
    };
    const first = value.cells[0]!;
    const polygon = registeredCellPolygon(value, first)!;
    const center = {
      x: polygon.reduce((sum, point) => sum + point.x, 0) / 4,
      y: polygon.reduce((sum, point) => sum + point.y, 0) / 4,
    };
    expect(photoCellAt(value, center)?.id).toBe(first.id);
    expect(photoCellAt(value, { x: 0.99, y: 0.99 })).toBeNull();
    expect(
      validRegistration([
        value.photo.registration[0],
        value.photo.registration[2],
        value.photo.registration[1],
        value.photo.registration[3],
      ]),
    ).toBe(false);
    const aligned = {
      ...value,
      photo: {
        ...value.photo,
        registration: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ] as const,
      },
    };
    const b = experimentBounds(value);
    const gapX = (first.bounds.maxX + value.cells[1]!.bounds.minX) / 2;
    expect(photoCellAt(aligned, { x: (gapX - b.minX) / (b.maxX - b.minX), y: 0.2 })).toBeNull();
  });
  it.each([false, true])(
    'retains whole laser/CNC process and tools through save/reopen (CNC=%s)',
    (cnc) => {
      const project = recipeProject(cnc);
      const experiment = captureArtworkExperiment(
        project,
        'source',
        'record',
        '2026-10-07T00:00:00.000Z',
      );
      useStore.getState().createLibrary('Tests');
      expect(useStore.getState().upsertMaterialExperiment(experiment).kind).toBe('ok');
      const before = useStore.getState().project;
      expect(
        useStore.getState().saveExperimentCellAsRecipe('record', '0-0', 'Reusable process').kind,
      ).toBe('ok');
      expect(useStore.getState().project).toBe(before);
      const library = useStore.getState().materialLibrary!;
      expect(library.processRecipes).toHaveLength(1);
      const text = serializeMaterialLibrary(library);
      const reopened = deserializeMaterialLibrary(text);
      expect(reopened.kind).toBe('ok');
      if (reopened.kind === 'ok') {
        expect(serializeMaterialLibrary(reopened.library)).toBe(text);
        expect(reopened.library.experiments?.[0]?.cells[0]?.process.steps).toEqual(
          experiment.cells[0]?.process.steps,
        );
        expect(reopened.library.processRecipes?.[0]?.tools).toEqual(
          experiment.cells[0]?.process.tools,
        );
      }
    },
  );
  it('saves a chosen grid cell as an existing material preset with evidence and no project edit', () => {
    useStore.getState().createLibrary('Tests');
    const record = {
      ...testExperiment(),
      material: 'Birch',
      thicknessMm: 3,
      selectedCellId: '0-0',
      notes: 'Batch 42',
      cells: testExperiment().cells.map((cell) => ({
        ...cell,
        observation: 'User inspection: clean edge',
      })),
    };
    useStore.getState().upsertMaterialExperiment(record);
    const result = useStore.getState().saveExperimentCellAsRecipe('test', '0-0', 'Cut result');
    expect(result.kind).toBe('ok');
    const preset = useStore.getState().materialLibrary?.entries[0];
    expect(preset).toMatchObject({
      materialName: 'Birch',
      thicknessMm: 3,
      recipe: { power: 10, speed: 3000 },
    });
    expect(preset?.calibrationProvenance).toContain('Physical completion is not verified');
    expect(
      deserializeMaterialLibrary(serializeMaterialLibrary(useStore.getState().materialLibrary!))
        .kind,
    ).toBe('ok');
  });
  it('keeps a named cell recipe portable even before result notes are entered', () => {
    useStore.getState().createLibrary('Tests');
    const record = { ...testExperiment(), material: 'Birch', thicknessMm: 3, notes: '' };
    expect(useStore.getState().upsertMaterialExperiment(record).kind).toBe('ok');
    expect(
      useStore.getState().saveExperimentCellAsRecipe('test', '0-0', 'Reusable engrave').kind,
    ).toBe('ok');
    const library = useStore.getState().materialLibrary!;
    expect(deserializeMaterialLibrary(serializeMaterialLibrary(library)).kind).toBe('ok');
    expect(library.entries[0]?.description).toContain('Reusable engrave');
  });
  it('rejects malformed geometry, wrong-machine processes and executable photo sources', () => {
    const record = testExperiment();
    expect(
      parseMaterialExperiments([
        { ...record, photo: { width: 10, height: 10, dataUrl: 'https://server.test/photo.png' } },
      ]).kind,
    ).toBe('invalid');
    expect(parseMaterialExperiments([{ ...record, machineKind: 'cnc' }]).kind).toBe('invalid');
    expect(
      parseMaterialExperiments([
        {
          ...record,
          cells: [{ ...record.cells[0], bounds: { minX: 5, maxX: 1, minY: 0, maxY: 1 } }],
        },
      ]).kind,
    ).toBe('invalid');
    expect(parseMaterialExperiments([{ ...record, selectedCellId: 'missing' }]).kind).toBe(
      'invalid',
    );
  });
  it('migrates legacy material libraries while refusing newer versions rather than discarding evidence', () => {
    useStore.getState().createLibrary('Tests');
    const library = useStore.getState().materialLibrary!;
    for (const version of [1, 2])
      expect(
        deserializeMaterialLibrary(JSON.stringify({ ...library, librarySchemaVersion: version }))
          .kind,
      ).toBe('ok');
    expect(
      deserializeMaterialLibrary(JSON.stringify({ ...library, librarySchemaVersion: 4 })).kind,
    ).toBe('schema-too-new');
  });
});
