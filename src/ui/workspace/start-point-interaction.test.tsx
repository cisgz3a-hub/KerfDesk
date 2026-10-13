import { act, useMemo, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, type Project } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { buildCanvasMarkerPlan } from '../state/canvas-motion-plan';
import { startMotionOperation } from '../state/laser-motion-operation';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { resetStore, svgObj } from '../state/test-helpers';
import { useStartPointInteraction } from './start-point-interaction';
import { CanvasStartPoints } from './CanvasStartPoints';
import { computeView } from './view-transform';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaserState = useLaserStore.getState();
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
      layers: [createLayer({ id: 'line', color: '#000000' })],
      objects: [
        {
          ...svgObj('box', ['#000000']),
          bounds: { minX: 10, minY: 20, maxX: 50, maxY: 60 },
          paths: [{ color: '#000000', polylines: [{ closed: true, points }] }],
        },
      ],
    },
  };
}

function Harness(props: {
  readonly planRevision?: number;
  readonly showHandles?: boolean;
  readonly retainPlan?: boolean;
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
    view: { zoomFactor: 1, panX: 0, panY: 0 },
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
  await act(async () => {
    root?.render(<Harness />);
  });
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
  await act(async () => {
    root?.unmount();
  });
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
  await act(async () => {
    host.querySelector('button')?.dispatchEvent(event);
  });
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

describe('start point drag transactions', () => {
  it('accumulates rapid arrow presses while the new start-only plan is pending', async () => {
    await act(async () => {
      root?.render(<Harness retainPlan />);
    });
    await pressKey('ArrowRight');
    await pressKey('ArrowRight');
    await act(async () => {
      const button = host.querySelector('button');
      button?.dispatchEvent(keyEvent('ArrowRight'));
      button?.dispatchEvent(keyEvent('ArrowRight', true));
    });
    await pressKey('ArrowLeft');
    expect(useStore.getState().project.startPoints?.job).toEqual({ x: 22, y: 20 });
    expect(useStore.getState().undoStack).toHaveLength(5);
  });

  it.each([
    'project',
    'placement',
    'registration',
    'coordinates',
    'busy',
    'preparation',
    'epoch',
    'plan',
  ] as const)('invalidates retained keyboard geometry after %s changes', async (change) => {
    await act(async () => {
      root?.render(<Harness retainPlan />);
    });
    await pressKey('ArrowRight');
    const first = useStore.getState().project.startPoints;
    await act(async () => {
      switch (change) {
        case 'project':
          useStore.getState().setProjectNotes('changed');
          break;
        case 'placement':
          useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'center' } });
          break;
        case 'registration':
          usePrintCutSessionStore.getState().capture('first', { x: 1, y: 2 }, 0);
          break;
        case 'coordinates':
          useLaserStore.setState({ wcoCache: { x: 5, y: 0, z: 0 } });
          break;
        case 'busy':
          useLaserStore.setState({ motionOperation: startMotionOperation('frame') });
          useLaserStore.setState({ motionOperation: null });
          break;
        case 'preparation':
          useFramePreparationStore.setState({ pending: true });
          useFramePreparationStore.setState({ pending: false });
          break;
        case 'epoch':
          useStore.setState({ projectDocumentEpoch: 5 });
          break;
        case 'plan':
          root?.render(<Harness retainPlan planRevision={1} />);
          break;
      }
    });
    const undoCount = useStore.getState().undoStack.length;
    await pressKey('ArrowRight');
    expect(useStore.getState().project.startPoints).toEqual(first);
    expect(useStore.getState().undoStack).toHaveLength(undoCount);
  });

  it('ignores stationary and sub-three-screen-pixel pointer jitter', async () => {
    await pointer('pointerdown', 10, 20);
    await pointer('pointermove', 10, 20);
    await pointer('pointermove', 11, 20);
    await pointer('pointerup', 11, 20);
    expectDiscarded();
  });

  it('allows idle focused-handle Escape to reach global dismissal', async () => {
    const dismissal = vi.fn();
    window.addEventListener('keydown', dismissal);
    try {
      const event = await pressKey('Escape');
      expect(event.defaultPrevented).toBe(false);
      expect(dismissal).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('keydown', dismissal);
    }
  });

  it('consumes Escape while a drag owns a draft', async () => {
    await beginDrag();
    const dismissal = vi.fn();
    window.addEventListener('keydown', dismissal);
    try {
      const event = await pressKey('Escape');
      expect(event.defaultPrevented).toBe(true);
      expect(dismissal).not.toHaveBeenCalled();
      await pointer('pointerup');
      expectDiscarded();
    } finally {
      window.removeEventListener('keydown', dismissal);
    }
  });
  it('keeps arrow keys on busy focusable handles from reaching artwork shortcuts', async () => {
    await act(async () => {
      useLaserStore.setState({ motionOperation: startMotionOperation('frame') });
      root?.render(<Harness showHandles />);
    });
    const shortcut = vi.fn();
    window.addEventListener('keydown', shortcut);
    try {
      const handle = host.querySelector<HTMLButtonElement>('[aria-label="Job start"]');
      expect(handle?.getAttribute('aria-disabled')).toBe('true');
      await act(async () =>
        handle?.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(shortcut).not.toHaveBeenCalled();
      expectDiscarded();
    } finally {
      window.removeEventListener('keydown', shortcut);
    }
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'ignores IME arrow events %j',
    async (composition) => {
      await act(async () =>
        host.querySelector('button')?.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            bubbles: true,
            cancelable: true,
            ...composition,
          }),
        ),
      );
      expectDiscarded();
    },
  );

  it('discards a draft when a new coordinate plan replaces it for the same project', async () => {
    await beginDrag();
    await act(async () => {
      root?.render(<Harness planRevision={1} />);
    });
    await pointer('pointerup');
    expectDiscarded();
  });

  it('previews multiple moves and commits one undoable selection only on release', async () => {
    await beginDrag();
    await pointer('pointermove', 30, 18);
    expectDraft(30, 20);
    await pointer('pointerup', 30, 18);
    expect(useStore.getState().project.startPoints?.job?.x).toBeCloseTo(30, 8);
    expect(useStore.getState().project.startPoints?.job?.y).toBeCloseTo(20, 8);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().dirty).toBe(true);
    expect(host.querySelector('output')?.textContent).toBe('no draft');
    await act(async () => {
      useStore.getState().undo();
    });
    expect(useStore.getState().project.startPoints).toBeUndefined();
  });

  it('discards a draft if the machine becomes busy before release without another move', async () => {
    await beginDrag();
    useLaserStore.setState({ motionOperation: startMotionOperation('frame') });
    await pointer('pointerup');
    expectDiscarded();
  });

  it('discards a draft when document ownership changes before release', async () => {
    await beginDrag();
    useStore.setState((state) => ({ projectDocumentEpoch: state.projectDocumentEpoch + 1 }));
    await pointer('pointerup');
    expectDiscarded();
  });

  it('cannot apply a stale draft to a newly opened project', async () => {
    await beginDrag();
    await act(async () => {
      useStore.getState().setProject(createProject());
    });
    await pointer('pointerup');
    expectDiscarded();
  });

  it.each(['pointercancel', 'lostpointercapture'])(
    'discards %s without changing the project',
    async (type) => {
      await beginDrag();
      await pointer(type);
      await pointer('pointerup');
      expectDiscarded();
    },
  );

  it('ignores release from another pointer', async () => {
    await beginDrag();
    await pointer('pointerup', 20, 20, 2);
    expect(useStore.getState().project.startPoints).toBeUndefined();
    expectDraft(20, 20);
    await pointer('pointerup');
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});

function keyEvent(key: string, shiftKey = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
}

async function pressKey(key: string, shiftKey = false): Promise<KeyboardEvent> {
  const event = keyEvent(key, shiftKey);
  await act(async () => {
    host.querySelector('button')?.dispatchEvent(event);
  });
  return event;
}
