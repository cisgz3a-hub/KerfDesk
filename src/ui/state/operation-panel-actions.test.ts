import { beforeEach, describe, expect, it } from 'vitest';
import { artwork, operation } from '../../core/cut-order.test-support';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const layerIds = (): ReadonlyArray<string> =>
  useStore.getState().project.scene.layers.map((layer) => layer.id);
const outputs = (): ReadonlyArray<boolean> =>
  useStore.getState().project.scene.layers.map((layer) => layer.output);
const visibility = (): ReadonlyArray<boolean> =>
  useStore.getState().project.scene.layers.map((layer) => layer.visible);

function importThree(): void {
  useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
  useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));
  useStore.getState().importSvgObject(svgObj('C', ['#0000ff']));
  const [, second] = layerIds();
  if (second !== undefined)
    useStore.getState().setLayerParam(second, { output: false, visible: false });
  useStore.setState({ dirty: false, undoStack: [], redoStack: [] });
}

describe('switches for every operation', () => {
  beforeEach(() => {
    resetStore();
    importThree();
  });

  it('turns every Output switch on in one undo step, then has nothing left to do', () => {
    useStore.getState().setEveryOperationOutput(true);

    expect(outputs()).toEqual([true, true, true]);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().setEveryOperationOutput(true);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(outputs()).toEqual([true, false, true]);
  });

  it('turns every Output switch off, or inverts each one', () => {
    useStore.getState().invertEveryOperationOutput();
    expect(outputs()).toEqual([false, true, false]);

    useStore.getState().setEveryOperationOutput(false);
    expect(outputs()).toEqual([false, false, false]);
    expect(useStore.getState().undoStack).toHaveLength(2);
  });

  it('shows every operation or inverts visibility, one undo step each', () => {
    useStore.getState().setEveryOperationVisible(true);
    expect(visibility()).toEqual([true, true, true]);

    useStore.getState().invertEveryOperationVisible();
    expect(visibility()).toEqual([false, false, false]);
    expect(useStore.getState().undoStack).toHaveLength(2);
  });

  it('hiding every operation also clears the selection of the artwork it hid', () => {
    useStore.getState().selectObject('A');

    useStore.getState().setEveryOperationVisible(false);

    expect(visibility()).toEqual([false, false, false]);
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});

describe('sortCutsLast', () => {
  beforeEach(() => {
    resetStore();
    const { project } = useStore.getState();
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          layers: [operation('cut'), operation('engrave', 'fill')],
          objects: [
            artwork('outline', [{ operationId: 'cut', rect: [0, 0, 50, 50] }]),
            artwork('logo', [{ operationId: 'engrave', rect: [10, 10, 10, 10] }]),
          ],
          artworkOrder: ['outline', 'logo'],
        },
      },
      undoStack: [],
      dirty: false,
    });
  });

  it('runs the cuts last in one undo step and reports how many cuts it found', () => {
    expect(useStore.getState().sortCutsLast()).toEqual({ cutOperationCount: 1, moved: true });

    const { scene } = useStore.getState().project;
    expect(layerIds()).toEqual(['engrave', 'cut']);
    expect(scene.artworkOrder).toEqual(['logo', 'outline']);
    expect(useStore.getState().undoStack).toHaveLength(1);

    expect(useStore.getState().sortCutsLast()).toEqual({ cutOperationCount: 1, moved: false });
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(layerIds()).toEqual(['cut', 'engrave']);
    expect(useStore.getState().project.scene.artworkOrder).toEqual(['outline', 'logo']);
  });

  it('does nothing for a CNC job', () => {
    const { project } = useStore.getState();
    useStore.setState({ project: { ...project, machine: DEFAULT_CNC_MACHINE_CONFIG } });

    expect(useStore.getState().sortCutsLast()).toEqual({ cutOperationCount: 0, moved: false });
    expect(layerIds()).toEqual(['cut', 'engrave']);
  });
});
