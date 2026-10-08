import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixtureTemplatesPanel } from './FixtureTemplatesPanel';
import { fixturePiece, fixtureTemplate } from '../../../core/camera/fixtures/fixture-test-support';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { usePieceScanStore } from './piece-scan-store';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  transformedBBox,
} from '../../../core/scene';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null,
  host: HTMLDivElement | null = null;
const source = {
  kind: 'usb' as const,
  stream: {
    stream: {} as MediaStream,
    sourceId: 'fixture-camera',
    resizeMode: 'none' as const,
    stop: () => undefined,
  },
};
beforeEach(() => {
  usePieceScanStore.getState().clear();
  const base = createProject();
  const cameraModel = savedCameraModel({
    version: 1,
    sourceKind: 'usb',
    sourceId: 'fixture-camera',
    width: 1280,
    height: 720,
    resizeMode: 'none',
  });
  const object = {
    kind: 'imported-svg' as const,
    id: 'design',
    source: 'design.svg',
    bounds: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x: 110, y: 95 },
    operationIds: ['cut'],
    paths: [
      {
        color: 'black',
        operationIds: ['cut'],
        polylines: [
          {
            closed: true,
            points: [
              { x: -10, y: -5 },
              { x: 10, y: -5 },
              { x: 10, y: 5 },
              { x: -10, y: 5 },
              { x: -10, y: -5 },
            ],
          },
        ],
      },
    ],
  };
  useStore.setState({
    project: {
      ...base,
      device: { ...base.device, cameraModel },
      scene: {
        objects: [object],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [{ id: 'assembly', name: 'Assembly', objectIds: ['design'] }],
      },
    },
    projectDocumentEpoch: 42,
    selectedObjectId: 'design',
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  useCameraStore.setState({
    sourceState: { kind: 'live', source },
    surfaceHeightMm: 3,
    heightAreas: [],
    overlayVisible: false,
    placementActive: false,
  });
});
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  usePieceScanStore.getState().clear();
});
async function mount(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<FixtureTemplatesPanel />));
}
async function click(text: string): Promise<void> {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === text,
  );
  if (button === undefined) throw new Error(`Missing button ${text}`);
  await act(async () => Simulate.click(button));
  if (button.type === 'submit') await act(async () => Simulate.submit(button.closest('form')!));
}
async function enter(label: string, value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  input.value = value;
  await act(async () => Simulate.change(input));
}
async function checkReview(): Promise<void> {
  const input = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ).find((candidate) => candidate.title.startsWith('Confirm that you reviewed'))!;
  input.checked = true;
  await act(async () => Simulate.change(input));
}
function withSaved(): void {
  const state = useStore.getState(),
    template = fixtureTemplate();
  useStore.setState({
    project: {
      ...state.project,
      fixtureTemplates: [
        { ...template, camera: { ...template.camera!, model: state.project.device.cameraModel! } },
      ],
    },
  });
}

describe('saved fixture and observation review', () => {
  it('saves included scan geometry, sample intent and camera context without changing calibration or scene', async () => {
    usePieceScanStore
      .getState()
      .setPieces([
        fixturePiece(100, 100),
        fixturePiece(250, 100, 30),
        { ...fixturePiece(350, 300), partial: true },
      ]);
    const before = useStore.getState().project,
      camera = useCameraStore.getState();
    await mount();
    await click('Save current fixture');
    await enter('Fixture name', 'Coaster jig');
    await click('Save fixture');
    const after = useStore.getState();
    expect(after.project.fixtureTemplates).toHaveLength(1);
    const template = after.project.fixtureTemplates![0]!;
    expect(template.name).toBe('Coaster jig');
    expect(template.slots).toHaveLength(2);
    expect(template.sample!.design.centre).toEqual({ x: 110, y: 95 });
    expect(template.camera!.surfaceHeightMm).toBe(3);
    expect(after.project.device).toBe(before.device);
    expect(after.project.scene).toBe(before.scene);
    expect(useCameraStore.getState().sourceState).toBe(camera.sourceState);
    expect(after.undoStack).toEqual([before]);
  });
  it('requires explicit review, resets it after height changes and places selection copies in one undo step', async () => {
    withSaved();
    const before = useStore.getState().project;
    await mount();
    await click('Coaster fixture · 2 slots');
    const place = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Place reviewed selection',
    )!;
    expect(place.disabled).toBe(true);
    await checkReview();
    expect(place.disabled).toBe(false);
    await act(async () => useCameraStore.getState().setSurfaceHeightMm(8));
    expect(place.disabled).toBe(true);
    expect(document.body.textContent).toContain('height areas differ');
    await checkReview();
    await click('Place reviewed selection');
    const state = useStore.getState();
    expect(state.undoStack).toEqual([before]);
    expect(state.project.scene.objects).toHaveLength(2);
    expect(state.project.scene.layers).toBe(before.scene.layers);
    expect(state.project.scene.objects[0]!.id).toBe('design');
    const copy = state.project.scene.objects[1]!,
      bounds = transformedBBox(copy);
    const centre = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    expect(centre.x).toBeCloseTo(250 + 10 * Math.cos(Math.PI / 6) + 5 * Math.sin(Math.PI / 6), 8);
    expect(centre.y).toBeCloseTo(100 + 10 * Math.sin(Math.PI / 6) - 5 * Math.cos(Math.PI / 6), 8);
    expect(copy.operationIds).toEqual(['cut']);
  });
  it('records independently entered checkpoint errors at their own height without replacing the archived calibration', async () => {
    withSaved();
    useCameraStore.getState().setSurfaceHeightMm(8);
    const before = useStore.getState().project;
    await mount();
    await click('Coaster fixture · 2 slots');
    await click('Record placement observations');
    const save = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save observations',
    )!;
    expect(save.disabled).toBe(true);
    await enter('Observed X 1', '100.3');
    await enter('Observed Y 1', '100.4');
    expect(document.body.textContent).toContain('maximum 0.500 mm');
    await click('Save observations');
    const template = useStore.getState().project.fixtureTemplates![0]!;
    expect(template.camera!.surfaceHeightMm).toBe(3);
    expect(template.qualification!.camera!.surfaceHeightMm).toBe(8);
    expect(template.qualification!.points[0]!.observedMm).toEqual({ x: 100.3, y: 100.4 });
    expect(useStore.getState().project.device).toBe(before.device);
    expect(useStore.getState().project.scene).toBe(before.scene);
    expect(useStore.getState().undoStack).toEqual([before]);
  });
  it('rejects document reopen or selection drift without placing saved geometry', async () => {
    withSaved();
    const before = useStore.getState().project;
    await mount();
    await click('Coaster fixture · 2 slots');
    await checkReview();
    await act(async () => useStore.setState({ projectDocumentEpoch: 43 }));
    const place = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Place reviewed selection',
    )!;
    expect(place.disabled).toBe(true);
    await click('Place reviewed selection');
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toEqual([]);
  });
});
