import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import type { ReliefHeightfieldSourceKind } from '../../core/scene/relief';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ReliefSourceMeaning } from './ReliefSourceMeaning';
import { SelectedReliefProperties } from './SelectedReliefProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetStore());

const SOURCE_CASES: ReadonlyArray<{
  readonly sourceKind: ReliefHeightfieldSourceKind;
  readonly label: string;
  readonly description: string;
}> = [
  {
    sourceKind: 'depth-map',
    label: 'Depth map',
    description: 'Declared scalar depth data.',
  },
  {
    sourceKind: 'brightness-emboss',
    label: 'Brightness emboss',
    description: 'Artistic emboss — not recovered 3D geometry.',
  },
  {
    sourceKind: 'relative-depth-map',
    label: 'Relative-depth map',
    description: 'Relative depth — not millimetres; map its range to physical depth.',
  },
  {
    sourceKind: 'editable-relief-map',
    label: 'Editable relief map',
    description: 'Operator-authored scalar data.',
  },
  {
    sourceKind: 'stl-top-projection',
    label: 'STL top projection',
    description: 'Top projection only; undercuts are not represented.',
  },
];

describe('ReliefSourceMeaning', () => {
  it.each(SOURCE_CASES)('shows $label as a persisted read-only declaration', (source) => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<ReliefSourceMeaning sourceKind={source.sourceKind} />);

    const meaning = host.querySelector('[aria-label="Relief declared source meaning"]');
    expect(meaning?.textContent).toContain('Declared source meaning');
    expect(meaning?.textContent).toContain(source.label);
    expect(meaning?.textContent).toContain(source.description);
    expect(meaning?.querySelector('input, select, button')).toBeNull();
  });

  it('derives the truthful STL top-projection disclosure for a selected legacy mesh', async () => {
    const relief = legacyMeshRelief();
    const base = createProject();
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [relief],
        layers: [
          createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR }),
        ],
      },
    };
    useStore.setState({ project });
    useStore.getState().setMachineKind('cnc');
    useStore.getState().selectObject(relief.id);
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(<SelectedReliefProperties />));
    try {
      const meaning = host.querySelector('[aria-label="Relief declared source meaning"]');
      expect(meaning?.textContent).toContain('STL top projection');
      expect(meaning?.textContent).toContain('Top projection only; undercuts are not represented.');
      expect(meaning?.querySelector('input, select, button')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});

function legacyMeshRelief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'mesh-relief',
    source: 'model.stl',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 10, 0, 0, 0, 5, 5],
      emptyCells: 'floor',
    },
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}
