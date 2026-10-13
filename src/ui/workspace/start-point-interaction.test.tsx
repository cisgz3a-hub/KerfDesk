import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { parseStatusReport } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { startMotionOperation } from '../state/laser-motion-operation';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import {
  root,
  host,
  Harness,
  pointer,
  beginDrag,
  expectDraft,
  expectDiscarded,
} from './start-point-interaction.test-fixture';
describe('start point drag transactions', () => {
  it.each([
    { zoomFactor: 2, panX: 0, panY: 0 },
    { zoomFactor: 1, panX: 10, panY: 0 },
    { zoomFactor: 1, panX: 0, panY: 10 },
  ])('discards a drag when the rendered view changes to %j', async (view) => {
    await beginDrag();
    await act(async () => root?.render(<Harness view={view} />));
    expectDiscarded();
    await act(async () => root?.render(<Harness />));
    await pointer('pointermove', 30, 20);
    await pointer('pointerup', 30, 20);
    expectDiscarded();
  });

  it('discards a transient zoom shortcut even if the original view is restored before render', async () => {
    await beginDrag();
    const { zoomFactor } = useUiStore.getState();
    await act(async () => {
      useUiStore.setState({ zoomFactor: zoomFactor * 2 });
      useUiStore.setState({ zoomFactor });
    });
    expectDiscarded();
    await pointer('pointerup', 30, 20);
    expectDiscarded();
  });

  it('does not commit a stale draft after the canvas resizes without another pointer move', async () => {
    await beginDrag();
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('missing canvas');
    canvas.width = 500;
    await pointer('pointerup', 30, 20);
    expectDiscarded();
  });

  it('accumulates rapid arrow presses while the new start-only plan is pending', async () => {
    await act(async () => root?.render(<Harness retainPlan />));
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
    await act(async () => root?.render(<Harness retainPlan />));
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
      await act(async () => handle?.dispatchEvent(keyEvent('ArrowRight')));
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
    await act(async () => root?.render(<Harness planRevision={1} />));
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
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project.startPoints).toBeUndefined();
  });

  it.each(['busy', 'preparing', 'coordinates', 'epoch'])(
    'permanently discards a pointer draft after transient %s changes before release',
    async (change) => {
      await beginDrag();
      await act(async () => {
        if (change === 'busy') {
          useLaserStore.setState({ motionOperation: startMotionOperation('frame') });
          useLaserStore.setState({ motionOperation: null });
        } else if (change === 'preparing') {
          useFramePreparationStore.setState({ pending: true });
          useFramePreparationStore.setState({ pending: false });
        } else if (change === 'coordinates') {
          const previous = useLaserStore.getState().wcoCache;
          useLaserStore.setState({ wcoCache: { x: 5, y: 0, z: 0 } });
          useLaserStore.setState({ wcoCache: previous });
        } else useStore.setState({ projectDocumentEpoch: 5 });
      });
      expectDiscarded();
      await pointer('pointerup');
      expectDiscarded();
    },
  );

  it('keeps a drag across fresh idle reports with unchanged coordinates', async () => {
    const point = { x: 0, y: 0, z: 0 };
    const report = (wco = '|WCO:0,0,0') =>
      parseStatusReport(`<Idle|MPos:0,0,0|WPos:0,0,0${wco}|FS:0,0>`);
    expect(report()).not.toBeNull();
    useLaserStore.setState({ statusReport: report(), wcoCache: point });
    await beginDrag();
    await act(async () =>
      useLaserStore.setState({ wcoCache: { ...point }, statusReport: report('') }),
    );
    expectDraft(20, 20);
    await pointer('pointerup');
    expect(useStore.getState().project.startPoints?.job?.x).toBeCloseTo(20, 8);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('cannot apply a stale draft to a newly opened project', async () => {
    await beginDrag();
    await act(async () => useStore.getState().setProject(createProject()));
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
  await act(async () => host.querySelector('button')?.dispatchEvent(event));
  return event;
}
