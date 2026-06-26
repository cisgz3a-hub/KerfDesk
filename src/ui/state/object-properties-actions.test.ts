import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

beforeEach(() => {
  resetStore();
});

describe('object property actions', () => {
  it('sets power scale on the primary selected object', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');

    useStore.getState().setSelectedObjectsPowerScale(50);

    expect(useStore.getState().project.scene.objects[0]?.powerScale).toBe(50);
  });

  it('sets power scale on the whole multi-selection', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#00ff00']));
    useStore.setState({ selectedObjectId: 'O1', additionalSelectedIds: new Set(['O2']) });

    useStore.getState().setSelectedObjectsPowerScale(75);

    expect(useStore.getState().project.scene.objects.map((object) => object.powerScale)).toEqual([
      75, 75,
    ]);
  });

  it('clamps power scale changes and creates one undo frame', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    useStore.getState().setSelectedObjectsPowerScale(25);
    useStore.setState({ undoStack: [], redoStack: [] });

    useStore.getState().setSelectedObjectsPowerScale(150);

    expect(useStore.getState().project.scene.objects[0]?.powerScale).toBe(100);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('sets operation overrides only on selected objects', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O3', ['#000000']));
    useStore.setState({ selectedObjectId: 'O2', additionalSelectedIds: new Set(['O3']) });

    const actions = useStore.getState() as typeof useStore extends { getState: () => infer State }
      ? State & {
          readonly setSelectedObjectsOperationOverride: (
            patch: Readonly<{ mode: 'fill'; power: number; speed: number }>,
          ) => void;
        }
      : never;
    actions.setSelectedObjectsOperationOverride({ mode: 'fill', power: 42, speed: 2222 });

    expect(
      useStore.getState().project.scene.objects.map((object) => object.operationOverride),
    ).toEqual([
      undefined,
      { mode: 'fill', power: 42, speed: 2222 },
      { mode: 'fill', power: 42, speed: 2222 },
    ]);
  });
});
