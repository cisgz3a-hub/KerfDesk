import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type GridArraySpec,
  type Project,
  type TextObject,
} from '../../core/scene';
import type { VariableTextRenderer } from '../../io/gcode/prepare-output-snapshot';
import type { AppState } from './store';

export const NOW = new Date('2026-09-23T03:04:05.000Z');
export const GRID: GridArraySpec = { kind: 'grid', rows: 2, columns: 3, spacingX: 5, spacingY: 3 };
export const NAMES = ['A', 'B'.repeat(40), 'CCC', 'D', 'E', 'F'];
export const renderFixture: VariableTextRenderer = async ({ text, content }) => ({
  bounds: { minX: 0, minY: 0, maxX: content.length, maxY: 2 },
  paths: [
    {
      color: text.color,
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: content.length, y: 2 },
          ],
        },
      ],
    },
  ],
});
export function fixtureState(): AppState {
  const name: TextObject = {
    kind: 'text',
    id: 'name',
    content: 'old',
    fontKey: 'roboto-regular',
    sizeMm: 5,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    // eslint-disable-next-line no-restricted-syntax -- fixture scene color is artwork data.
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    paths: [],
    transform: IDENTITY_TRANSFORM,
    operationIds: ['op'],
    variableTemplate: {
      tokens: [
        { kind: 'csv', column: 'name' },
        { kind: 'literal', value: '-' },
        { kind: 'serial', prefix: '', width: 3 },
      ],
    },
  };
  const detail: TextObject = {
    ...name,
    id: 'detail',
    transform: { ...IDENTITY_TRANSFORM, y: 4 },
    variableTemplate: { tokens: [{ kind: 'serial', prefix: 'D', width: 3, offset: 100 }] },
  };
  const { variableTemplate: _template, ...plain } = name;
  const fixed: TextObject = {
    ...plain,
    id: 'fixed',
    content: 'Fixed',
    transform: { ...IDENTITY_TRANSFORM, y: 8 },
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 2 },
  };
  const project: Project = {
    ...createProject(),
    variables: {
      recordIndex: 0,
      serialValue: 10,
      advancement: 'after-successful-export',
      csv: { sourceName: 'names.csv', headers: ['name'], records: NAMES.map((name) => [name]) },
    },
    scene: {
      objects: [name, detail, fixed],
      // eslint-disable-next-line no-restricted-syntax -- fixture operation color binds artwork data.
      layers: [createLayer({ id: 'op', color: '#000000' })],
      groups: [{ id: 'badge', name: 'Badge', objectIds: ['name', 'detail', 'fixed'] }],
    },
  };
  return {
    project,
    selectedObjectId: 'name',
    additionalSelectedIds: new Set(['detail', 'fixed']),
    undoStack: [],
    redoStack: [],
    projectDocumentEpoch: 1,
  } as unknown as AppState;
}
export function textValues(project: Project): string[] {
  return project.scene.objects.flatMap((object) =>
    object.kind === 'text' ? [object.content] : [],
  );
}
