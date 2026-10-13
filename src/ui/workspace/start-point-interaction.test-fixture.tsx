import { act, useMemo, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { createLayer, createProject, type Project } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { buildCanvasMarkerPlan } from '../state/canvas-motion-plan';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { resetStore, svgObj } from '../state/test-helpers';
import { useStartPointInteraction } from './start-point-interaction';
import { CanvasStartPoints } from './CanvasStartPoints';
import { computeView, type ViewState } from './view-transform';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaserState = useLaserStore.getState();
// eslint-disable-next-line no-restricted-syntax -- Literal operation colour in scene test data, not UI chrome.
const CUT_COLOR = '#000000';
let root: Root | undefined;
let host: HTMLDivElement;

function projectFixture(): Project {
  const base = createProject();
  const points = [
    { x: 10, y: 20 },
    { x: 50, y: 20 },
    { x: 50, y: 60 },
    { x: 10, y: 60 },
    { x: 10, y: 20 },
  ];
  return {
    ...base,
    device: { ...base.device, bedWidth: 300, bedHeight: 300, origin: 'rear-left' },
    scene: {
      layers: [createLayer({ id: 'line', color: CUT_COLOR })],
      objects: [
        {
          ...svgObj('box', [CUT_COLOR]),
          bounds: { minX: 10, minY: 20, maxX: 50, maxY: 60 },
          paths: [{ color: CUT_COLOR, polylines: [{ closed: true, points }] }],
        },
      ],
    },
  };
}

function Harness(props: {
  readonly planRevision?: number;
  readonly showHandles?: boolean;
  readonly retainPlan?: boolean;
  readonly view?: ViewState;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const project = useStore((state) => state.project);
  const originalProject = useRef(project);
  const sourceProject = props.retainPlan ? originalProject.current : project;
  const prepared = useMemo(() => prepareOutput(sourceProject), [sourceProject]);
  const plan = useMemo(() => {
    if (!prepared.ok) throw new Error('expected prepared fixture');
    return buildCanvasMarkerPlan({
      prepared,
      relativeView: true,
      machine: {
        statusReport: null,
        alarmCode: null,
        hasActiveStreamer: false,
        trustedPositionEpoch: props.planRevision ?? 0,
      },
    });
  }, [prepared, props.planRevision]);
  if (!prepared.ok) throw new Error('expected prepared fixture');
  const handlers = useStartPointInteraction({
    canvas,
    project,
    plan,
    context:
      sourceProject === project
        ? { prepared, sourceProject: project, registered: false }
        : undefined,
    view: props.view ?? { zoomFactor: 1, panX: 0, panY: 0 },
  });
  return (
    <>
      <canvas ref={canvas} width={348} height={348} />
      {props.showHandles ? (
        <CanvasStartPoints
          canvas={canvas}
          project={project}
          view={{ zoomFactor: 1, panX: 0, panY: 0 }}
          size={{ width: 348, height: 348 }}
          overlay={{ plan, run: null, planIsCurrent: sourceProject === project }}
        />
      ) : (
        <button
          type="button"
          onPointerDown={(event) => handlers.down('job', { x: 10, y: 20 }, event)}
          onPointerMove={handlers.move}
          onPointerUp={handlers.up}
          onPointerCancel={handlers.cancel}
          onLostPointerCapture={handlers.cancel}
          onKeyDown={(event) =>
            handlers.key('job', { x: 10, y: 20 }, event, sourceProject !== project)
          }
        >
          Job start
        </button>
      )}
      <output>
        {handlers.draft === null
          ? 'no draft'
          : `${handlers.draft.point.x},${handlers.draft.point.y}`}
      </output>
    </>
  );
}

beforeEach(async () => {
  resetStore();
  useStore.setState({ project: projectFixture() });
  useLaserStore.setState({
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    framedRunStartClaim: null,
  });
  usePrintCutSessionStore.getState().clear();
  useFramePreparationStore.setState({ pending: false });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Harness />));
  const canvas = host.querySelector('canvas');
  const button = host.querySelector('button');
  if (canvas === null || button === null) throw new Error('missing harness controls');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 100,
    y: 200,
    left: 100,
    top: 200,
    width: 696,
    height: 696,
    right: 796,
    bottom: 896,
    toJSON: () => ({}),
  });
  button.setPointerCapture = vi.fn();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  resetStore();
  useLaserStore.setState(originalLaserState);
  usePrintCutSessionStore.getState().clear();
  useFramePreparationStore.setState({ pending: false });
  vi.restoreAllMocks();
});

async function pointer(type: string, x = 20, y = 20, pointerId = 1) {
  const view = computeView(348, 348, 300, 300);
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 100 + 2 * (view.offsetX + view.scale * x),
    clientY: 200 + 2 * (view.offsetY + view.scale * y),
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  await act(async () => host.querySelector('button')?.dispatchEvent(event));
}

async function beginDrag() {
  await pointer('pointerdown', 10, 20);
  await pointer('pointermove', 20, 18);
  expectDraft(20, 20);
  expect(useStore.getState().project.startPoints).toBeUndefined();
  expect(useStore.getState().undoStack).toHaveLength(0);
}

function expectDraft(x: number, y: number) {
  const coordinates = host.querySelector('output')?.textContent?.split(',').map(Number);
  expect(coordinates?.[0]).toBeCloseTo(x, 8);
  expect(coordinates?.[1]).toBeCloseTo(y, 8);
}

function expectDiscarded() {
  expect(useStore.getState().project.startPoints).toBeUndefined();
  expect(useStore.getState().undoStack).toHaveLength(0);
  expect(useStore.getState().dirty).toBe(false);
  expect(host.querySelector('output')?.textContent).toBe('no draft');
}

export { root, host, Harness, pointer, beginDrag, expectDraft, expectDiscarded };
