import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { resolveJobPlacement } from '../job-placement';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import type { CanvasMotionOverlay } from './draw-canvas-motion';
import {
  buildIdleCanvasMotionPlan,
  IDLE_CANVAS_PLAN_DELAY_MS,
  useCanvasMotionOverlay,
} from './use-canvas-motion-overlay';
import type { StatusReport } from '../../core/controllers/grbl';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;
let observedOverlay: CanvasMotionOverlay | null = null;
let harnessRenders = 0;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  observedOverlay = null;
  harnessRenders = 0;
  useUiStore.getState().setShowCanvasStartMarkers(true);
});

describe('idle canvas motion plan', () => {
  it('builds markers through the prepared-output pipeline', async () => {
    const decoded = deserializeProject(readFileSync('e2e/fixtures/project-basic.lf2', 'utf8'));
    if (decoded.kind !== 'ok') throw new Error(`Fixture failed to load: ${decoded.kind}`);
    const laser = {
      connection: { kind: 'disconnected' as const },
      statusReport: null,
      alarmCode: null,
      hasActiveStreamer: false,
      controllerSettings: null,
      reportInches: false,
      workOriginActive: false,
      wcoCache: null,
      trustedPositionEpoch: 0,
      statusQuery: 'realtime-report' as const,
    };
    const placementSettings = { startFrom: 'absolute' as const, anchor: 'front-left' as const };
    const placement = resolveJobPlacement(placementSettings, laser);
    const plan = await buildIdleCanvasMotionPlan(
      {
        project: decoded.project,
        previewMode: false,
        liveRun: null,
        outputScope: DEFAULT_OUTPUT_SCOPE,
        placementSettings,
        placement,
        rotaryRaster: false,
        registrationKey: '',
        machineRevision: 'test-machine',
        interactionActive: false,
        laser,
      },
      placement,
    );
    expect(plan?.framePerimeter).toHaveLength(5);
    expect(plan?.jobStart).not.toBeNull();
  });

  it('publishes the asynchronously built plan from the hook', async () => {
    const decoded = deserializeProject(readFileSync('e2e/fixtures/project-basic.lf2', 'utf8'));
    if (decoded.kind !== 'ok') throw new Error(`Fixture failed to load: ${decoded.kind}`);
    useStore.setState({
      project: decoded.project,
      jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
    });
    useLaserStore.setState(initialLaserState());
    useUiStore.getState().setShowCanvasStartMarkers(false);
    host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host as HTMLDivElement);
      root.render(createElement(Harness, { project: decoded.project }));
    });
    await waitForPublishedOverlay();
    expect(observedOverlay?.plan.jobStart).not.toBeNull();
    expect(observedOverlay?.showStartMarkers).toBe(false);
  });

  it('does not rerender the workspace hook for every moving status sample', async () => {
    const decoded = deserializeProject(readFileSync('e2e/fixtures/project-basic.lf2', 'utf8'));
    if (decoded.kind !== 'ok') throw new Error(`Fixture failed to load: ${decoded.kind}`);
    useStore.setState({
      project: decoded.project,
      jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
    });
    useLaserStore.setState(initialLaserState());
    host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host as HTMLDivElement);
      root.render(createElement(Harness, { project: decoded.project }));
      await new Promise((resolve) => window.setTimeout(resolve, IDLE_CANVAS_PLAN_DELAY_MS + 50));
    });
    const beforeMotion = harnessRenders;
    await act(async () => {
      for (let x = 0; x < 100; x += 1) {
        useLaserStore.setState({ statusReport: report(x, 'Run') });
      }
    });
    expect(harnessRenders - beforeMotion).toBeLessThanOrEqual(1);
  });

  it('defers marker rebuilding until a canvas transform interaction settles', async () => {
    const decoded = deserializeProject(readFileSync('e2e/fixtures/project-basic.lf2', 'utf8'));
    if (decoded.kind !== 'ok') throw new Error(`Fixture failed to load: ${decoded.kind}`);
    useStore.setState({
      project: decoded.project,
      jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
    });
    useLaserStore.setState(initialLaserState());
    host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host as HTMLDivElement);
      root.render(createElement(StoreHarness));
      await new Promise((resolve) => window.setTimeout(resolve, IDLE_CANVAS_PLAN_DELAY_MS + 50));
    });
    expect(observedOverlay?.plan.jobStart).not.toBeNull();
    await act(async () => {
      useStore.getState().beginInteraction();
      useStore.getState().setObjectTransform('e2e-square', {
        x: 5,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        mirrorX: false,
        mirrorY: false,
      });
    });
    expect(observedOverlay).toBeNull();
    const rendersWhileDragging = harnessRenders;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, IDLE_CANVAS_PLAN_DELAY_MS + 50));
    });
    expect(harnessRenders).toBe(rendersWhileDragging);
    await act(async () => {
      useStore.getState().endInteraction();
      await new Promise((resolve) => window.setTimeout(resolve, IDLE_CANVAS_PLAN_DELAY_MS + 50));
    });
    expect(observedOverlay?.plan.jobStart).not.toBeNull();
  });
});

function Harness(props: { readonly project: Parameters<typeof useCanvasMotionOverlay>[0] }) {
  harnessRenders += 1;
  observedOverlay = useCanvasMotionOverlay(props.project, false);
  return null;
}

async function waitForPublishedOverlay(): Promise<void> {
  for (let attempt = 0; attempt < 50 && observedOverlay === null; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  expect(observedOverlay).not.toBeNull();
}

function StoreHarness() {
  const project = useStore((state) => state.project);
  return createElement(Harness, { project });
}

function report(x: number, state: StatusReport['state']): StatusReport {
  return {
    state,
    subState: null,
    mPos: { x, y: 0, z: 0 },
    wPos: { x, y: 0, z: 0 },
    feed: 1000,
    spindle: 0,
    wco: null,
  };
}
