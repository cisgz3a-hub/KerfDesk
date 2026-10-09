import { composeReliefInWorker } from './relief-authoring-worker-client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ReliefAuthoringMaterializationResult } from '../../core/relief/materialize-relief-authoring';
import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene/machine';
import { materializeReliefAuthoring } from '../../core/relief/materialize-relief-authoring';
import { createReliefAuthoringDocument } from '../../core/relief/relief-authoring-document';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ReliefAuthoringDialog } from './ReliefAuthoringDialog';
import { CreateEditableReliefButton } from './CreateEditableReliefButton';

vi.mock('./relief-authoring-worker-client', () => ({
  composeReliefInWorker: vi.fn(async (document) => materializeReliefAuthoring(document)),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
});
function object(): HeightfieldReliefObject {
  const source = testReliefHeightfield({
    width: 3,
    height: 3,
    physicalWidthMm: 6,
    physicalHeightMm: 6,
    maxDepthMm: 5,
    samplesU16: Array.from({ length: 9 }, () => 20000),
  });
  return {
    kind: 'relief',
    id: 'R1',
    source: 'U16 source',
    reliefSource: source,
    targetWidthMm: 6,
    reliefDepthMm: 5,
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 6, maxY: 6 },
    transform: IDENTITY_TRANSFORM,
  };
}
function install(relief = object()): void {
  const vector = {
    kind: 'shape' as const,
    id: 'V1',
    name: 'Border',
    spec: { kind: 'rect' as const, widthMm: 6, heightMm: 6, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 6, maxY: 6 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 6, y: 0 },
              { x: 6, y: 6 },
              { x: 0, y: 6 },
            ],
          },
        ],
      },
    ],
  };
  useStore.setState({
    project: {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { objects: [relief, vector], layers: [] },
    },
    undoStack: [],
  });
}
function CurrentDialog(): JSX.Element {
  const relief = useStore((s) =>
    s.project.scene.objects.find((o) => o.id === 'R1'),
  ) as HeightfieldReliefObject;
  return <ReliefAuthoringDialog relief={relief} onClose={() => undefined} />;
}
const button = (text: string): HTMLButtonElement => {
  const value = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (value === undefined) throw new Error(`Missing button ${text}`);
  return value;
};

describe('relief authoring workflow', () => {
  it('creates a retained scalar relief through the CNC creation control', async () => {
    useStore.setState({ project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG } });
    await act(async () => root.render(<CreateEditableReliefButton />));
    await act(async () => button('Create editable relief…').click());
    await act(async () => button('Create relief').click());
    const created = useStore
      .getState()
      .project.scene.objects.find((o) => o.kind === 'relief') as HeightfieldReliefObject;
    expect(created.reliefAuthoring?.width).toBe(256);
    expect(created.reliefSource.kind).toBe('heightfield-v1');
    expect(useStore.getState().selectedObjectId).toBe(created.id);
  });
  it('adds a linked dome with one undo snapshot and preserves source codes', async () => {
    const original = object();
    install(original);
    await act(async () => root.render(<CurrentDialog />));
    const select = host.querySelector(
      '[aria-label="New relief shape profile"]',
    ) as HTMLSelectElement;
    await act(async () => {
      select.value = 'dome';
      Simulate.change(select);
    });
    await act(async () => button('Create shape from vector').click());
    const edited = useStore
      .getState()
      .project.scene.objects.find((o) => o.id === 'R1') as HeightfieldReliefObject;
    expect(edited.reliefAuthoring?.components).toHaveLength(2);
    const source = edited.reliefAuthoring?.components[1]?.source;
    expect(source?.kind === 'vector-shape-v1' && source.profile).toBe('dome');
    expect(source?.kind === 'vector-shape-v1' && source.boundary.linkedObjectId).toBe('V1');
    expect(useStore.getState().undoStack).toHaveLength(1);
    await act(async () => useStore.getState().undo());
    const restored = useStore
      .getState()
      .project.scene.objects.find((o) => o.id === 'R1') as HeightfieldReliefObject;
    expect(restored.reliefSource).toEqual(original.reliefSource);
    expect(restored.reliefAuthoring).toBeUndefined();
  });
  it('completed pointer stroke is one exact undo step and pointer cancellation leaves no edit', async () => {
    const original = object();
    install(original);
    await act(async () => root.render(<CurrentDialog />));
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    canvas.setPointerCapture = () => undefined;
    canvas.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 6,
      bottom: 6,
      width: 6,
      height: 6,
      toJSON: () => ({}),
    });
    await act(async () => {
      Simulate.pointerDown(canvas, { button: 0, clientX: 3, clientY: 3 });
      Simulate.pointerCancel(canvas);
    });
    expect(useStore.getState().undoStack).toHaveLength(0);
    await act(async () => {
      Simulate.pointerDown(canvas, { button: 0, clientX: 3, clientY: 3 });
      Simulate.pointerUp(canvas, { clientX: 3, clientY: 3 });
    });
    const edited = useStore
      .getState()
      .project.scene.objects.find((o) => o.id === 'R1') as HeightfieldReliefObject;
    expect(edited.reliefAuthoring?.strokes).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(1);
    await act(async () => useStore.getState().undo());
    expect(
      (
        useStore
          .getState()
          .project.scene.objects.find((o) => o.id === 'R1') as HeightfieldReliefObject
      ).reliefSource.samplesBase64,
    ).toBe(original.reliefSource.samplesBase64);
  });
});

it('creates a linked rail surface and adds a positioned section as separate undo steps', async () => {
  install();
  const current = useStore.getState().project;
  useStore.setState({
    project: {
      ...current,
      scene: {
        ...current.scene,
        objects: [
          ...current.scene.objects,
          {
            kind: 'imported-svg',
            id: 'rail-vector',
            source: 'Open rail',
            bounds: { minX: 0, minY: 3, maxX: 6, maxY: 3 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#000000',
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 0, y: 3 },
                      { x: 6, y: 3 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });
  await act(async () => root.render(<CurrentDialog />));
  const railChoice = host.querySelector('[aria-label="First open rail"]') as HTMLSelectElement;
  const width = host.querySelector('[aria-label="Single rail width (mm)"]') as HTMLInputElement;
  await act(async () => {
    railChoice.value = 'rail-vector';
    Simulate.change(railChoice);
    width.value = '2';
    Simulate.blur(width);
  });
  await act(async () => button('Create rail surface').click());
  const getSource = () => {
    const relief = useStore
      .getState()
      .project.scene.objects.find((o) => o.id === 'R1') as HeightfieldReliefObject;
    return relief.reliefAuthoring?.components[1]?.source;
  };
  const source = getSource();
  expect(source?.kind === 'rail-profile-v1' && source.rail.linkedObjectId).toBe('rail-vector');
  expect(source?.kind === 'rail-profile-v1' && source.widthMm).toBe(2);
  expect(useStore.getState().undoStack).toHaveLength(1);
  await act(async () => button('Add positioned section').click());
  const edited = getSource();
  expect(
    edited?.kind === 'rail-profile-v1' && edited.sections.map((section) => section.position),
  ).toEqual([0, 0.5, 1]);
  expect(useStore.getState().undoStack).toHaveLength(2);
  await act(async () => useStore.getState().undo());
  expect(getSource()?.kind).toBe('rail-profile-v1');
  const restored = getSource();
  expect(restored?.kind === 'rail-profile-v1' && restored.sections).toHaveLength(2);
});

it('discloses a closed rail as unsupported without changing retained source or undo', async () => {
  install();
  const original = useStore.getState().project;
  await act(async () => root.render(<CurrentDialog />));
  await act(async () => button('Create rail surface').click());
  expect(host.textContent).toContain('exactly one open vector path');
  expect(useStore.getState().project).toBe(original);
  expect(useStore.getState().undoStack).toHaveLength(0);
});

it('cancels composition after target placement changes and ignores a late worker result', async () => {
  install();
  let resolve: ((result: ReliefAuthoringMaterializationResult) => void) | undefined,
    candidate: ReliefAuthoringDocument | undefined,
    signal: AbortSignal | undefined;
  vi.mocked(composeReliefInWorker).mockImplementationOnce((doc, abort) => {
    candidate = doc;
    signal = abort;
    return new Promise((done) => {
      resolve = done;
    });
  });
  await act(async () => root.render(<CurrentDialog />));
  await act(async () => button('Create shape from vector').click());
  if (candidate === undefined || resolve === undefined)
    throw new Error('Composition was not requested.');
  await act(async () =>
    useStore.getState().applyObjectTransform('R1', { ...IDENTITY_TRANSFORM, x: 10 }),
  );
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    resolve?.(materializeReliefAuthoring(candidate as ReliefAuthoringDocument)),
  );
  const relief = useStore
    .getState()
    .project.scene.objects.find((o) => o.id === 'R1') as HeightfieldReliefObject;
  expect(relief.transform.x).toBe(10);
  expect(relief.reliefAuthoring).toBeUndefined();
  expect(useStore.getState().undoStack).toHaveLength(1);
});

it('preserves legacy relief on opening, applies current semantics on editing and restores exact Undo', async () => {
  const original = object();
  const legacy: HeightfieldReliefObject = {
    ...original,
    reliefAuthoring: {
      ...createReliefAuthoringDocument(original.reliefSource),
      algorithmRevision: 'retained-relief-v1',
    },
  };
  install(legacy);
  await act(async () => root.render(<CurrentDialog />));
  expect(host.textContent).toContain('Editing it applies corrected edges and profiles');
  expect(useStore.getState().project.scene.objects[0]).toBe(legacy);
  await act(async () => button('Create shape from vector').click());
  const edited = useStore.getState().project.scene.objects[0] as HeightfieldReliefObject;
  expect(edited.reliefAuthoring?.algorithmRevision).toBe('retained-relief-v2');
  expect(edited.reliefAuthoring?.revision).toBe(original.reliefSource.revision + 1);
  await act(async () => useStore.getState().undo());
  expect(useStore.getState().project.scene.objects[0]).toBe(legacy);
});

it('rejects an over-budget legacy edit before worker dispatch and preserves its original field', async () => {
  const saved = JSON.parse(
    gunzipSync(
      readFileSync(resolve('src/__fixtures__/parent-saved-512px-clipped-import.lf2.gz')),
    ).toString('utf8'),
  ) as { scene: { objects: HeightfieldReliefObject[] } };
  const savedRelief = saved.scene.objects[0];
  if (savedRelief === undefined) throw new Error('Missing legacy fixture');
  const legacy = { ...savedRelief, id: 'R1' };
  install(legacy);
  const before = useStore.getState().project;
  vi.mocked(composeReliefInWorker).mockClear();
  await act(async () => root.render(<CurrentDialog />));
  await act(async () => button('Create shape from vector').click());
  expect(host.textContent).toContain('work budget');
  expect(composeReliefInWorker).not.toHaveBeenCalled();
  expect(useStore.getState().project).toBe(before);
  expect(useStore.getState().undoStack).toHaveLength(0);
});

it('keeps component and rail control identities distinct through sculpting and undo', async () => {
  const original = object();
  install({ ...original, reliefAuthoring: createReliefAuthoringDocument(original.reliefSource) });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await act(async () => root.render(<CurrentDialog />));
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    canvas.setPointerCapture = () => undefined;
    canvas.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 6,
      bottom: 6,
      width: 6,
      height: 6,
      toJSON: () => ({}),
    });
    const pointer = { pointerId: 1, clientX: 3, clientY: 3 };
    await act(async () => {
      Simulate.pointerDown(canvas, { button: 0, ...pointer });
      Simulate.pointerUp(canvas, pointer);
    });
    const edited = useStore
      .getState()
      .project.scene.objects.find((item) => item.id === 'R1') as HeightfieldReliefObject;
    expect(edited.reliefAuthoring?.strokes).toHaveLength(1);
    expect(edited.reliefSource.samplesBase64).not.toBe(original.reliefSource.samplesBase64);
    await act(async () => useStore.getState().undo());
    expect(
      (
        useStore
          .getState()
          .project.scene.objects.find((item) => item.id === 'R1') as HeightfieldReliefObject
      ).reliefSource,
    ).toBe(original.reliefSource);
    expect(host.querySelectorAll('[aria-label="Relief component name"]')).toHaveLength(1);
    expect(
      errors.mock.calls.filter((call) =>
        /same key|duplicate.*key|unique.*key/i.test(call.map(String).join(' ')),
      ),
    ).toEqual([]);
  } finally {
    errors.mockRestore();
  }
});
