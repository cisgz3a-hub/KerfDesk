import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { buildCanvasMarkerPlan } from '../state/canvas-motion-plan';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { useLaserStore } from '../state/laser-store';
import { readStartPointDefaults, writeStartPointDefaults } from '../state/start-point-defaults';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { CanvasStartPoints } from './CanvasStartPoints';
import type { CanvasMotionOverlay } from './draw-canvas-motion';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const originalLaser = useLaserStore.getState();
const defaults = {
  frame: { edge: 1 as const, fraction: 0.5 },
  job: { x: 0.25, y: 0.75, relative: true as const },
};
let root: Root;
let host: HTMLDivElement;

function Harness({ overlay }: { readonly overlay: CanvasMotionOverlay | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const project = useStore((state) => state.project);
  return (
    <>
      <canvas ref={canvas} />
      <CanvasStartPoints
        canvas={canvas}
        project={project}
        overlay={overlay}
        view={{ zoomFactor: 1, panX: 0, panY: 0 }}
        size={{ width: 348, height: 348 }}
      />
    </>
  );
}

beforeEach(() => {
  resetStore();
  writeStartPointDefaults(defaults);
  useLaserStore.setState({
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    framedRunStartClaim: null,
  });
  useFramePreparationStore.setState({ pending: false });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  writeStartPointDefaults({});
  useLaserStore.setState(originalLaser);
  useFramePreparationStore.setState({ pending: false });
});
function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}
async function show(overlay: CanvasMotionOverlay | null = null) {
  await act(async () => root.render(<Harness overlay={overlay} />));
  await act(async () => button('Start points').click());
}

describe('start settings without a current motion plan', () => {
  it('clears saved defaults and resets starts from an empty new project', async () => {
    useStore.getState().newProject();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().project.startPoints).toEqual(defaults);
    await show();
    expect(host.querySelector('.lf-start-handle')).toBeNull();
    expect(button('Use as defaults for new jobs').disabled).toBe(true);
    await act(async () => button('Clear saved defaults').click());
    expect(readStartPointDefaults()).toBeUndefined();
    expect(useStore.getState().project.startPoints).toEqual(defaults);
    await act(async () => button('Automatic frame start').click());
    expect(useStore.getState().project.startPoints).toEqual({ job: defaults.job });
    await act(async () => button('Automatic job start').click());
    expect(useStore.getState().project.startPoints).toBeUndefined();
    expect(useStore.getState().undoStack).toHaveLength(2);
    await act(async () => useStore.getState().newProject());
    expect(useStore.getState().project.startPoints).toBeUndefined();
  });

  it.each(['missing', 'stale'] as const)(
    'permits resets with artwork while the plan is %s',
    async (availability) => {
      const project = {
        ...createProject(),
        startPoints: defaults,
        scene: {
          layers: [createLayer({ id: '#000000', color: '#000000' })],
          objects: [svgObj('line', ['#000000'])],
        },
      };
      useStore.setState({ project });
      const prepared = prepareOutput(project);
      if (!prepared.ok) throw new Error('Expected prepared artwork');
      const plan = buildCanvasMarkerPlan({
        prepared,
        relativeView: true,
        machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
      });
      await show(availability === 'missing' ? null : { plan, run: null, planIsCurrent: false });
      expect(button('Use as defaults for new jobs').disabled).toBe(true);
      await act(async () => button('Automatic job start').click());
      expect(useStore.getState().project.startPoints).toEqual({ frame: defaults.frame });
      expect(useStore.getState().project.scene).toBe(project.scene);
    },
  );

  it.each(['preparing', 'interaction'] as const)(
    'blocks changes without a plan during %s',
    async (busy) => {
      useStore.getState().newProject();
      await show();
      await act(async () => {
        if (busy === 'preparing') useFramePreparationStore.setState({ pending: true });
        else useStore.getState().beginInteraction();
      });
      for (const label of [
        'Clear saved defaults',
        'Automatic job start',
        'Automatic frame start',
      ]) {
        expect(button(label).disabled).toBe(true);
        await act(async () => button(label).click());
      }
      expect(useStore.getState().project.startPoints).toEqual(defaults);
      expect(readStartPointDefaults()).toEqual(defaults);
    },
  );
});
