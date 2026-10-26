import { afterEach, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { projectInspectionDesign } from './inspection-design';

// ADR-580 Amendment 1: the Inspector compares the carved stock with the side
// the program carves, which follows the current stock, not the stored mesh.

afterEach(() => resetStore());

function withStock(project: Project, thicknessMm: number): Project {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected a CNC machine');
  return { ...project, machine: { ...machine, stock: { ...machine.stock, thicknessMm } } };
}

it('designs a split side for the current stock', () => {
  const top = [0, 0, 10, 20, 0, 10, 20, 20, 10, 0, 0, 10, 20, 20, 10, 0, 20, 10];
  const bottom = top.map((value, at) => (at % 3 === 2 ? 0 : value));
  useStore.setState({
    project: withStock(
      {
        ...createProject(),
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        scene: {
          objects: [
            {
              kind: 'relief',
              id: 'model',
              source: 'model.stl',
              reliefSource: {
                kind: 'legacy-mesh',
                meshPositions: [...top, ...bottom],
                emptyCells: 'floor',
              },
              targetWidthMm: 20,
              reliefDepthMm: 10,
              color: DEFAULT_RELIEF_LAYER_COLOR,
              bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
              transform: IDENTITY_TRANSFORM,
            },
          ],
          layers: [createLayer({ id: 'relief-op', color: DEFAULT_RELIEF_LAYER_COLOR })],
        },
      },
      14,
    ),
  });
  const split = useStore
    .getState()
    .splitReliefForTwoSides('model', { splitHeightMm: 5, webMm: 1, marginMm: 4 });
  if (split.kind !== 'ok') throw new Error(split.reason);
  const placement = { jobOriginOffset: { x: 0, y: 0 }, reliefIds: [split.sideAId] };
  const project = useStore.getState().project;
  // Side A cuts from its face, 2 mm over the model on 14 mm stock, to the 5 mm split.
  expect(projectInspectionDesign(project, placement)?.reliefs[0]?.relief.reliefDepthMm).toBe(7);
  const thicker = projectInspectionDesign(withStock(project, 18), placement);
  expect(thicker?.reliefs[0]?.relief.reliefDepthMm).toBeCloseTo(9, 9);
});
