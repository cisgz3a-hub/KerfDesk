import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findRegistrationBoxes } from '../../../core/scene';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { BoardCapturePanel } from './BoardCapturePanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaser = useLaserStore.getState();
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  useLaserStore.setState(originalLaser, true);
  useUiStore.setState({ boardCapturePanelOpen: false });
  useStore.getState().newProject();
  vi.restoreAllMocks();
});

describe('pending board correction ownership', () => {
  it.each([
    ['Undo', () => useStore.getState().undo()],
    ['removing the board', () => useStore.getState().removeRegistrationBox()],
    [
      'replacing it with an equal-sized board',
      () => useStore.getState().addCapturedBoardBox(120, 80),
    ],
    [
      'resizing the same board',
      () => useStore.getState().updateCapturedBoard({ kind: 'rect', widthMm: 90, heightMm: 60 }),
    ],
    ['New project', () => useStore.getState().newProject()],
    [
      'reopening the identical project',
      () => useStore.getState().setProject(useStore.getState().project),
    ],
    [
      'a controller session change',
      () =>
        useLaserStore.setState((s) => ({ controllerSessionEpoch: s.controllerSessionEpoch + 1 })),
    ],
    [
      'a trusted-position change',
      () =>
        useLaserStore.setState((s) => ({
          trustedPositionEpoch: (s.trustedPositionEpoch ?? 0) + 1,
        })),
    ],
    [
      'an additional origin change',
      () => useLaserStore.setState((s) => ({ workOriginVersion: (s.workOriginVersion ?? 0) + 1 })),
    ],
  ] as const)('does not publish after %s', async (_label, supersede) => {
    const { host, settle } = await pendingCorrection();
    await act(async () => {
      supersede();
    });
    const before = useStore.getState();
    const scene = before.project.scene;
    const undo = before.undoStack;
    const redo = before.redoStack;

    await settle();

    const after = useStore.getState();
    expect(after.project.scene).toBe(scene);
    expect(after.undoStack).toBe(undo);
    expect(after.redoStack).toBe(redo);
    expect(host.textContent).not.toContain(
      'Bottom-left corner updated from the current head position',
    );
    expect(host.textContent).toContain('Capture the board again');
  });

  it.each([false, true])(
    'commits a still-owned correction with unrelated project edit=%s',
    async (edit) => {
      const { host, settle } = await pendingCorrection();
      const outline = findRegistrationBoxes(useStore.getState().project.scene)[0]!;
      if (edit) {
        await act(async () => {
          useStore.getState().setProjectNotes('Notes edited while saving');
        });
      }
      const undoCount = useStore.getState().undoStack.length;
      await settle();
      expect(findRegistrationBoxes(useStore.getState().project.scene)[0]).toMatchObject({
        id: outline.id,
        spec: { kind: 'rect', widthMm: 120, heightMm: 80 },
      });
      expect(useStore.getState().undoStack).toHaveLength(undoCount + 1);
      if (edit) expect(useStore.getState().project.notes).toBe('Notes edited while saving');
      expect(host.textContent).toContain(
        'Bottom-left corner updated from the current head position',
      );
      // The correction's own origin update advances this version legitimately.
      expect(useLaserStore.getState().workOriginVersion).toBe(2);
    },
  );

  it.each([false, true])('handles pending circle-center correction with Undo=%s', async (undo) => {
    const { host, settle } = await pendingCorrection('circle');
    if (undo) await act(async () => useStore.getState().undo());
    const scene = useStore.getState().project.scene;
    await settle();
    if (undo) {
      expect(useStore.getState().project.scene).toBe(scene);
      expect(findRegistrationBoxes(scene)[0]?.spec).toMatchObject({
        kind: 'rect',
        widthMm: 40,
        heightMm: 40,
      });
      expect(host.textContent).not.toContain('Circle center updated');
      expect(host.textContent).toContain('Capture the board again');
    } else {
      expect(findRegistrationBoxes(useStore.getState().project.scene)[0]?.spec).toMatchObject({
        kind: 'ellipse',
        widthMm: 90,
        heightMm: 90,
      });
      expect(host.textContent).toContain('Circle center updated from the current head position');
      expect(useLaserStore.getState().workOriginVersion).toBe(2);
    }
  });
});

async function pendingCorrection(shape: 'rect' | 'circle' = 'rect'): Promise<{
  host: HTMLDivElement;
  settle: () => Promise<void>;
}> {
  useStore.getState().newProject();
  useStore.getState().addCapturedBoardBox(40, 40);
  let release = (): void => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let originCalls = 0;
  useLaserStore.setState({
    setOriginHere: vi.fn(async () => {
      if (++originCalls > 1) await pending;
      useLaserStore.setState((s) => ({ workOriginVersion: (s.workOriginVersion ?? 0) + 1 }));
    }),
    jogToMachinePosition: vi.fn(async () => undefined),
    connection: { kind: 'connected' },
    wcoCache: null,
    workOriginVersion: 0,
    pendingTransportWrites: 0,
    pendingUntrackedAcks: 0,
    controllerOperation: null,
    motionOperation: null,
  });
  useUiStore.setState({ boardCapturePanelOpen: true });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  cleanups.push(async () => {
    await act(async () => {
      release();
      await pending;
    });
    await act(async () => root.unmount());
    host.remove();
  });
  await act(async () => root.render(<BoardCapturePanel />));
  await position(50, 30);
  await captureBoard(host, shape);
  await click(
    host.querySelector('section[aria-label="Physically check board"]')!,
    shape === 'rect' ? 'Btm-left' : 'Center',
  );
  await position(52, 32);
  await click(host, 'No, adjust it');
  await click(host, 'Use current head position & update board');
  expect(host.textContent).toContain('Saving the corrected');
  return {
    host,
    settle: async () => {
      await act(async () => {
        release();
        await pending;
        await Promise.resolve();
      });
    },
  };
}

async function captureBoard(host: HTMLElement, shape: 'rect' | 'circle'): Promise<void> {
  if (shape === 'circle') {
    await click(host, 'Circle');
    await click(host, 'Center already marked');
  }
  await click(host, shape === 'rect' ? 'Capture corner' : 'Capture center');
  const dimensions =
    shape === 'rect'
      ? [
          ['Board width in mm', '120'],
          ['Board height in mm', '80'],
        ]
      : [['Circle diameter in mm', '90']];
  await act(async () => {
    for (const [label, value] of dimensions) {
      const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await click(host, shape === 'rect' ? 'Draw board at this size' : 'Create board outline');
}

async function position(x: number, y: number): Promise<void> {
  await act(async () =>
    useLaserStore.setState((s) => ({
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x, y, z: 0 },
        wPos: null,
        feed: null,
        spindle: null,
        wco: null,
      },
      statusSequence: s.statusSequence + 1,
    })),
  );
}

async function click(scope: ParentNode, text: string): Promise<void> {
  const button = [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  expect(button, text).toBeDefined();
  expect(button!.disabled, text).toBe(false);
  await act(async () => {
    button!.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}
