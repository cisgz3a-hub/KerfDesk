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
import type { CanvasMotionOverlay } from './draw-canvas-motion';
import { buildIdleCanvasMotionPlan, useCanvasMotionOverlay } from './use-canvas-motion-overlay';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;
let observedOverlay: CanvasMotionOverlay | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  observedOverlay = null;
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
    host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host as HTMLDivElement);
      root.render(createElement(Harness, { project: decoded.project }));
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });
    expect(observedOverlay?.plan.jobStart).not.toBeNull();
  });
});

function Harness(props: { readonly project: Parameters<typeof useCanvasMotionOverlay>[0] }) {
  observedOverlay = useCanvasMotionOverlay(props.project, false);
  return null;
}
