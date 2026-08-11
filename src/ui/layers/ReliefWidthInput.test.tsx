import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { testLegacyMeshGeometry } from '../../__fixtures__/legacy-relief';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { reliefMachineSpaceGeometry } from '../../core/cnc/relief-machine-space';
import { reliefObjectToHeightmap } from '../../core/relief/relief-object-to-heightmap';
import {
  createProject,
  createLayer,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { prepareProjectForAutosave, prepareProjectForPersistence } from '../../io/project';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { reliefPropertyWidthMm } from './ReliefPlanningWidthDisclosure';
import { ReliefWidthInput } from './ReliefWidthInput';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RELIEF_ID = 'width-relief';

afterEach(() => resetStore());

describe('ReliefWidthInput extreme machine-space commits', () => {
  it.each([
    ['division underflow', 2, Number.MIN_VALUE],
    ['division overflow', Number.MIN_VALUE, 1],
  ] as const)(
    'commits a heightfield after %s without a lying draft',
    async (_label, scaleX, draft) => {
      const initial = heightfieldRelief(scaleX);
      install(initial);
      const beforeProject = useStore.getState().project;
      const { host, root } = await render();
      try {
        await commitWidth(host, draft);
        const stored = storedRelief();
        expect(stored.reliefSource.kind).toBe('heightfield-v1');
        if (stored.reliefSource.kind !== 'heightfield-v1') return;
        expect(stored.reliefSource.physicalWidthMm).toBe(draft);
        expect(stored.targetWidthMm).toBe(draft);
        expect(Math.abs(stored.transform.scaleX)).toBe(1);
        expect(widthInput(host).value).toBe(String(draft));
        expect(useStore.getState().project).not.toBe(beforeProject);
        expect(useStore.getState().undoStack).toHaveLength(1);
        expect(useStore.getState().dirty).toBe(true);
        expectCommittedWorkflow(stored, draft);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );

  it.each([
    ['division underflow', 2, Number.MIN_VALUE],
    ['division overflow', Number.MIN_VALUE, 1],
  ] as const)(
    'commits a legacy mesh after %s without a lying draft',
    async (_label, scaleX, draft) => {
      const initial = meshRelief(scaleX);
      install(initial);
      const beforeProject = useStore.getState().project;
      const { host, root } = await render();
      try {
        await commitWidth(host, draft);
        const stored = storedRelief();
        expect(stored.reliefSource.kind).toBe('legacy-mesh');
        expect(stored.targetWidthMm).toBe(draft);
        expect(Math.abs(stored.transform.scaleX)).toBe(1);
        expect(stored.reliefSource).toBe(initial.reliefSource);
        expect(widthInput(host).value).toBe(String(draft));
        expect(useStore.getState().project).not.toBe(beforeProject);
        expect(useStore.getState().undoStack).toHaveLength(1);
        expect(useStore.getState().dirty).toBe(true);
        expectCommittedWorkflow(stored, draft);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
});

function HeightfieldHarness(): JSX.Element | null {
  const relief = useStore((state) => state.project.scene.objects[0]);
  if (relief?.kind !== 'relief') return null;
  const machine = reliefMachineSpaceGeometry(relief);
  return (
    <ReliefWidthInput
      relief={relief}
      widthMm={reliefPropertyWidthMm(relief, machine.targetScaleX)}
    />
  );
}

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<HeightfieldHarness />));
  return { host, root };
}

async function commitWidth(host: HTMLElement, value: number): Promise<void> {
  const input = widthInput(host);
  await act(async () => {
    input.value = String(value);
    Simulate.change(input);
  });
  await act(async () => Simulate.blur(input));
}

function widthInput(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector('input[aria-label="Relief width (mm)"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('width input missing');
  return input;
}

function install(relief: ReliefObject): void {
  const base = createProject();
  const project: Project = {
    ...base,
    scene: {
      ...base.scene,
      objects: [relief],
      layers: [createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR })],
    },
  };
  useStore.setState({ project, undoStack: [], dirty: false });
}

function storedRelief(): ReliefObject {
  const stored = useStore.getState().project.scene.objects[0];
  if (stored?.kind !== 'relief') throw new Error('stored relief missing');
  return stored;
}

function expectCommittedWorkflow(relief: ReliefObject, machineWidthMm: number): void {
  const project = useStore.getState().project;
  expect(reliefMachineSpaceGeometry(relief).widthMm).toBe(machineWidthMm);
  expect(prepareProjectForPersistence(project).kind).toBe('ok');
  expect(prepareProjectForAutosave(project).kind).toBe('ok');
  const materialized = reliefObjectToHeightmap(relief, {
    targetWidthMm: relief.targetWidthMm,
    reliefDepthMm: relief.reliefDepthMm,
    targetScaleX: Math.abs(relief.transform.scaleX),
    targetScaleY: Math.abs(relief.transform.scaleY),
    mmPerCell: 1,
  });
  expect(materialized.kind).toBe('ok');
  if (materialized.kind === 'ok') expect(materialized.widthMm).toBe(machineWidthMm);
}

function heightfieldRelief(scaleX: number): ReliefObject {
  return {
    kind: 'relief',
    id: RELIEF_ID,
    source: 'field.png',
    targetWidthMm: 1,
    reliefDepthMm: 1,
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 1,
      physicalHeightMm: 0.5,
      maxDepthMm: 1,
      samplesU8: [0, 255],
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0.5 },
    transform: { ...IDENTITY_TRANSFORM, scaleX },
  };
}

function meshRelief(scaleX: number): ReliefObject {
  return {
    kind: 'relief',
    id: RELIEF_ID,
    source: 'mesh.stl',
    targetWidthMm: 1,
    reliefDepthMm: 1,
    ...testLegacyMeshGeometry({
      positions: [0, 0, 0, 2, 0, 1, 0, 1, 0],
      targetWidthMm: 1,
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0.5 },
    transform: { ...IDENTITY_TRANSFORM, scaleX },
  };
}
