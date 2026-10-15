import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMaterialRecipe } from '../../core/material-library';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
} from '../../io/material-library';
import { useStore } from '../state/store';
import { addTestRectangle, resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  adapter = testAdapter();
});
afterEach(() => adapter.dispose());

describe('batch shape admission', () => {
  it.each([
    {
      closed: false,
      pointsMm: [
        { xMm: 3, yMm: 4 },
        { xMm: 3, yMm: 4 },
      ],
    },
    {
      closed: true,
      pointsMm: [
        { xMm: 0, yMm: 0 },
        { xMm: 10, yMm: 0 },
      ],
    },
    {
      closed: true,
      pointsMm: [
        { xMm: 0, yMm: 0 },
        { xMm: 10, yMm: 0 },
        { xMm: 0, yMm: 0 },
      ],
    },
  ])('refuses degenerate polylines before any batch item commits: %j', async (args) => {
    const before = useStore.getState();
    expect(resultCode(await adapter.execute('add_polyline', writeArgs(adapter, args)))).toBe(
      'invalid_arguments',
    );
    const result = await adapter.execute(
      'apply_edits',
      writeArgs(adapter, {
        edits: [
          { command: 'add_rectangle', args: { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 } },
          { command: 'add_polyline', args },
        ],
      }),
    );
    expect(resultCode(result)).toBe('invalid_arguments');
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toEqual(before.undoStack);
    expect(adapter.getRevision()).toBe(result.revision);
  });

  it.each([false, true])(
    'retains valid batch polylines and one Undo step (closed=%s)',
    async (closed) => {
      const pointsMm = [
        { xMm: 0, yMm: 0 },
        { xMm: 10, yMm: 0 },
        { xMm: 5, yMm: 10 },
      ];
      const result = await adapter.execute(
        'apply_edits',
        writeArgs(adapter, {
          edits: [{ command: 'add_polyline', args: { closed, pointsMm } }],
        }),
      );
      expect(resultCode(result)).toBe('ok');
      expect(useStore.getState().project.scene.objects).toHaveLength(1);
      expect(useStore.getState().undoStack).toHaveLength(1);
      useStore.getState().undo();
      expect(useStore.getState().project.scene.objects).toHaveLength(0);
    },
  );
});

describe('Laser operation arguments in CNC workspaces', () => {
  it.each(['single', 'batch'] as const)(
    'refuses an explicit Laser mode without creating an operation (%s)',
    async (mode) => {
      useStore.getState().setMachineKind('cnc');
      const before = useStore.getState();
      const result =
        mode === 'single'
          ? await adapter.execute('create_operation', writeArgs(adapter, { mode: 'fill' }))
          : await adapter.execute(
              'apply_edits',
              writeArgs(adapter, {
                edits: [
                  { command: 'add_rectangle', args: { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 } },
                  { command: 'create_operation', args: { mode: 'fill' } },
                ],
              }),
            );
      expect(resultCode(result)).toBe('unsupported_operation');
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toEqual(before.undoStack);
    },
  );

  it('creates a normal CNC operation when no Laser mode is supplied', async () => {
    useStore.getState().setMachineKind('cnc');
    const result = await adapter.execute(
      'create_operation',
      writeArgs(adapter, { name: 'Profile' }),
    );
    expect(resultCode(result)).toBe('ok');
    expect(useStore.getState().project.scene.layers[0]).toMatchObject({ name: 'Profile' });
  });

  it.each(['single', 'batch'] as const)(
    'refuses a Laser material recipe without changing the CNC project (%s)',
    async (mode) => {
      await addTestRectangle(adapter);
      const layer = useStore.getState().project.scene.layers[0]!;
      useStore.getState().setMaterialLibrary({
        format: MATERIAL_LIBRARY_FORMAT,
        librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
        libraryId: 'audit-library',
        name: 'Audit library',
        entries: [
          {
            id: 'recipe',
            materialName: 'Test material',
            thicknessMm: 3,
            description: '',
            revision: '1',
            recipe: { ...captureMaterialRecipe(layer), power: 37 },
          },
        ],
      });
      useStore.getState().setMachineKind('cnc');
      const before = useStore.getState();
      const args = { operationId: layer.id, recipeId: 'recipe' };
      const result =
        mode === 'single'
          ? await adapter.execute('apply_material_recipe', writeArgs(adapter, args))
          : await adapter.execute(
              'apply_edits',
              writeArgs(adapter, {
                edits: [
                  {
                    command: 'add_rectangle',
                    args: { xMm: 30, yMm: 0, widthMm: 10, heightMm: 10 },
                  },
                  { command: 'apply_material_recipe', args },
                ],
              }),
            );
      expect(resultCode(result)).toBe('unsupported_operation');
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toEqual(before.undoStack);
    },
  );
});
