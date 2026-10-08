import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { NodeCoordinateControls } from './NodeCoordinateControls';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  resetStore();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function open(): Promise<HTMLInputElement> {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'line',
    source: 'line.svg',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
            ],
          },
        ],
      },
    ],
  };
  useStore.setState({
    project: {
      ...createProject(),
      scene: { objects: [object], layers: [createLayer({ id: 'cut', color: '#000000' })] },
    },
  });
  useStore
    .getState()
    .selectPathNode({ objectId: 'line', pathIndex: 0, polylineIndex: 0, pointIndex: 0 });
  await act(async () => root.render(<NodeCoordinateControls />));
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Node coordinates"]')?.click(),
  );
  return document.querySelector<HTMLInputElement>('input[aria-label="Node X coordinate"]')!;
}
it('applies unit arithmetic once on Enter and ignores subsequent blur', async () => {
  const input = await open();
  await act(async () => {
    input.value = '1/2in + 2mm';
    Simulate.change(input);
  });
  expect(useStore.getState().undoStack).toHaveLength(0);
  await act(async () => Simulate.keyDown(input, { key: 'Enter' }));
  await act(async () => Simulate.blur(input));
  expect(useStore.getState().undoStack).toHaveLength(1);
  const object = useStore.getState().project.scene.objects[0] as ImportedSvg;
  expect(object.paths[0]?.polylines[0]?.points[0]?.x).toBeCloseTo(14.7, 10);
});
it('rejects invalid expressions and Escape abandons the draft', async () => {
  const input = await open();
  const before = useStore.getState().project;
  await act(async () => {
    input.value = '1/0';
    Simulate.change(input);
  });
  expect(input.getAttribute('aria-invalid')).toBe('true');
  await act(async () => Simulate.keyDown(input, { key: 'Enter' }));
  expect(useStore.getState().project).toBe(before);
  await act(async () => {
    input.value = '99';
    Simulate.change(input);
  });
  await act(async () => Simulate.keyDown(input, { key: 'Escape' }));
  await act(async () => Simulate.blur(input));
  expect(useStore.getState().project).toBe(before);
  expect(input.value).toBe('0');
});
