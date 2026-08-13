// Shared fixtures and render helpers for the SelectedReliefProperties suites.
// Extracted because the combined test file passed the 400-line hard cap; the
// two suites cover different controls but need the same project scaffolding.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { testLegacyMeshGeometry } from '../../__fixtures__/legacy-relief';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  createLayer,
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { useStore } from '../state';
import { SelectedReliefProperties } from './SelectedReliefProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export function relief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'model.stl',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    ...testLegacyMeshGeometry({
      positions: [0, 0, 0, 10, 0, 0, 0, 5, 5],
      targetWidthMm: 100,
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}

export function depthRelief(id = 'R1', gamma = 1): ReliefObject {
  return {
    kind: 'relief',
    id,
    source: 'depth.png',
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      maxDepthMm: 5,
      samplesU8: [0, 255],
      mapping: { curve: { kind: 'gamma-v1', gamma } },
      provenance: { sourceName: 'depth.png' },
    }),
    targetWidthMm: 100,
    reliefDepthMm: 5,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}

export function installProject(
  machineKind: 'laser' | 'cnc',
  object: ReliefObject = relief(),
): void {
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [object],
      layers: [createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR })],
    },
  };
  useStore.setState({ project });
  useStore.getState().setMachineKind(machineKind);
  useStore.getState().selectObject('R1');
}

export function gammaField(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector('input[aria-label="Relief height-map gamma"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('gamma input missing');
  return input;
}

export function storedGamma(id = 'R1'): number | null {
  const stored = useStore.getState().project.scene.objects.find((object) => object.id === id);
  return stored?.kind === 'relief' && stored.reliefSource.kind === 'heightfield-v1'
    ? stored.reliefSource.mapping.curve.gamma
    : null;
}

export async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<SelectedReliefProperties />);
  });
  return { host, root };
}
