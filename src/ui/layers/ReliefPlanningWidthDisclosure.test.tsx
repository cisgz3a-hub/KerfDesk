import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { reliefMachineSpaceGeometry } from '../../core/cnc/relief-machine-space';
import {
  createLayer,
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/relief';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ReliefFieldGeometry } from './ReliefFieldGeometry';
import {
  ReliefPlanningWidthDisclosure,
  reliefPropertyWidthMm,
  reliefPlanningWidthTitle,
} from './ReliefPlanningWidthDisclosure';
import { SelectedReliefProperties } from './SelectedReliefProperties';

// React exposes no narrower typed test seam for this documented act-environment flag.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  document.body.replaceChildren();
});

function relief(
  scaleX: number,
  physicalWidthMm = 100,
  targetWidthMm = physicalWidthMm,
): HeightfieldReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'field.png',
    targetWidthMm,
    reliefDepthMm: 5,
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm,
      physicalHeightMm: 1,
      maxDepthMm: 5,
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: targetWidthMm, maxY: 1 },
    transform: { ...IDENTITY_TRANSFORM, scaleX },
  };
}

async function render(node: React.ReactNode): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

function installSelectedRelief(object: ReliefObject): void {
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [object],
      layers: [createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR })],
    },
  };
  useStore.setState({ project });
  useStore.getState().setMachineKind('cnc');
  useStore.getState().selectObject(object.id);
}

describe('ReliefPlanningWidthDisclosure', () => {
  it('distinguishes ordinary native CAM planning width from exact zero compatibility', () => {
    expect(reliefPlanningWidthTitle(relief(-0.5))).toBe(
      'Heightmap planning width from the canonical source after native binary64 absolute object X scale. Field geometry uses exact-factor display math. Editing synchronizes the object target and source widths while preserving scale.',
    );
    expect(reliefPlanningWidthTitle(relief(0))).toBe(
      'Stored planning width. This zero-scale compatibility axis collapses after planning; editing width remains available.',
    );
  });

  it('renders no note for representable, exact-zero, or legacy-mesh planning width', async () => {
    const legacy: ReliefObject = {
      ...relief(0.5, Number.MIN_VALUE),
      reliefSource: {
        kind: 'legacy-mesh',
        meshPositions: [0, 0, 0, 1, 0, 0, 0, 1, 1],
        emptyCells: 'floor',
      },
    };
    expect(reliefPlanningWidthTitle(legacy)).toBe(
      'Carved width on the stock after object scale. Editing preserves the current scale.',
    );
    const { host, root } = await render(
      <>
        <ReliefPlanningWidthDisclosure relief={relief(1)} widthMm={100} />
        <ReliefPlanningWidthDisclosure relief={relief(0)} widthMm={100} />
        <ReliefPlanningWidthDisclosure relief={legacy} widthMm={0} />
      </>,
    );
    try {
      expect(host.childElementCount).toBe(0);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('reconciles positive source geometry with a native planning-width underflow', async () => {
    const object = relief(0.5, Number.MIN_VALUE);
    const planning = reliefMachineSpaceGeometry(object);
    const widthMm = reliefPropertyWidthMm(object, planning.targetScaleX);
    expect(widthMm).toBe(0);
    installSelectedRelief(object);
    const beforeProject = useStore.getState().project;
    const beforeUndo = useStore.getState().undoStack;
    const beforeDirty = useStore.getState().dirty;
    const { host, root } = await render(<SelectedReliefProperties />);
    try {
      expect(host.textContent).toContain('Physical size (relief W × H)2.47033e-324 × 1 mm');
      const width = host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(width instanceof HTMLInputElement)) throw new Error('width input missing');
      expect(width.value).toBe('0');
      expect(width.title).toContain('Heightmap planning width from the canonical source');
      expect(
        host.querySelector('[aria-label="Relief CAM planning width precision"]')?.textContent,
      ).toBe(
        'Native binary64 heightmap planning rounds this positive canonical source axis to 0 mm. Field geometry above preserves its source-factor magnitude as a six-significant-digit readout. Heightmap materialization requires the width to be finite and positive.',
      );
      expect(useStore.getState().project).toBe(beforeProject);
      expect(useStore.getState().undoStack).toBe(beforeUndo);
      expect(useStore.getState().dirty).toBe(beforeDirty);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('discloses native planning overflow without relabeling the finite source magnitude', async () => {
    const object = relief(100_000, Number.MAX_VALUE);
    const { host, root } = await render(
      <>
        <ReliefFieldGeometry source={object.reliefSource} transform={object.transform} />
        <ReliefPlanningWidthDisclosure relief={object} widthMm={Number.POSITIVE_INFINITY} />
      </>,
    );
    try {
      expect(host.textContent).toContain('Physical size (relief W × H)1.79769e+313 × 1 mm');
      expect(
        host.querySelector('[aria-label="Relief CAM planning width precision"]')?.textContent,
      ).toBe(
        'Native binary64 heightmap planning overflows this finite canonical source-axis magnitude to Infinity. Field geometry above preserves its source-factor magnitude as a six-significant-digit readout. Heightmap materialization requires the width to be finite and positive.',
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('follows canonical source width when near-equal stored duplicates diverge at underflow', async () => {
    const sourceUnderflows = relief(0.5, Number.MIN_VALUE, 1e-9);
    const sourceUnderflowPlanning = reliefMachineSpaceGeometry(sourceUnderflows);
    expect(sourceUnderflowPlanning.widthMm).toBe(0);
    const sourceWidthMm = reliefPropertyWidthMm(
      sourceUnderflows,
      sourceUnderflowPlanning.targetScaleX,
    );
    expect(sourceWidthMm).toBe(0);
    installSelectedRelief(sourceUnderflows);
    const sourceRender = await render(<SelectedReliefProperties />);
    try {
      const input = sourceRender.host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('width input missing');
      expect(input.value).toBe('0');
      expect(
        sourceRender.host.querySelector('[aria-label="Relief CAM planning width precision"]'),
      ).not.toBeNull();
    } finally {
      await act(async () => sourceRender.root.unmount());
    }

    const targetUnderflows = relief(0.5, 1e-9, Number.MIN_VALUE);
    const targetUnderflowPlanning = reliefMachineSpaceGeometry(targetUnderflows);
    expect(targetUnderflowPlanning.widthMm).toBe(5e-10);
    const targetWidthMm = reliefPropertyWidthMm(
      targetUnderflows,
      targetUnderflowPlanning.targetScaleX,
    );
    expect(targetWidthMm).toBe(5e-10);
    installSelectedRelief(targetUnderflows);
    const targetRender = await render(<SelectedReliefProperties />);
    try {
      const input = targetRender.host.querySelector('input[aria-label="Relief width (mm)"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('width input missing');
      expect(input.value).toBe('5e-10');
      expect(
        targetRender.host.querySelector('[aria-label="Relief CAM planning width precision"]'),
      ).toBeNull();
    } finally {
      await act(async () => targetRender.root.unmount());
    }
  });
});
