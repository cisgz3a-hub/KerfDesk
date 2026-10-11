import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
} from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { SelectedReliefProperties } from './SelectedReliefProperties';

let host: HTMLDivElement;
let root: Root;

function relief(id: string, depth: number): MeshReliefObject {
  return {
    kind: 'relief',
    id,
    source: `${id}.stl`,
    targetWidthMm: 20,
    reliefDepthMm: depth,
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 20, 0, 0, 0, 20, 10],
      emptyCells: 'floor',
    },
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
  };
}

beforeEach(async () => {
  resetStore();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useStore.setState({
    project: {
      ...createProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 70 },
      },
      scene: {
        objects: [relief('first', 60), relief('second', 10)],
        layers: [createLayer({ id: 'relief-op', color: DEFAULT_RELIEF_LAYER_COLOR })],
      },
    },
    selectedObjectId: 'first',
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<SelectedReliefProperties />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
  vi.unstubAllGlobals();
});

function input(label: string): HTMLInputElement {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing ${label}`);
  return element;
}

it.each(['selection', 'document'] as const)(
  'resets split drafts and proportion lock on %s change',
  async (change) => {
    expect(input('Two-sided split height (mm)').value).toBe('30');
    await act(async () => {
      input('Two-sided holding web (mm)').value = '8';
      Simulate.change(input('Two-sided holding web (mm)'));
      input('Two-sided margin (mm)').value = '25';
      Simulate.change(input('Two-sided margin (mm)'));
      input('Keep relief proportions').click();
    });
    expect(input('Keep relief proportions').checked).toBe(false);
    await act(async () => {
      if (change === 'selection') useStore.getState().selectObject('second');
      else {
        const state = useStore.getState();
        useStore.setState({
          project: {
            ...state.project,
            scene: { ...state.project.scene, objects: [relief('first', 10)] },
          },
          projectDocumentEpoch: state.projectDocumentEpoch + 1,
        });
      }
    });
    expect(input('Two-sided split height (mm)').value).toBe('5');
    expect(input('Two-sided holding web (mm)').value).toBe('1');
    expect(input('Two-sided margin (mm)').value).toBe('10');
    expect(input('Keep relief proportions').checked).toBe(true);
    const before = useStore.getState().project;
    await act(async () => {
      const create = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Create side A and side B',
      );
      if (create === undefined) throw new Error('Missing split button');
      create.click();
    });
    expect(useStore.getState().project.cncSetup?.twoSided?.sideBObjectIds).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(1);
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project).toBe(before);
  },
);
