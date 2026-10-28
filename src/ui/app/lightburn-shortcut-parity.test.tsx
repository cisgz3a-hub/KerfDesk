// LightBurn's design keys, pressed into KerfDesk's real window listeners: the
// useShortcuts hook, the capture-phase Abort and the keyboard jog (rolling audit
// v7 L8, ADR-410 Amendment 4, ADR-493 Amendment 2, ADR-499 Amendment 2). The
// oracle is LightBurn's Windows hotkey cheatsheet Rev 2.0 and its 1.7 Arrange
// and Distribute pages: each key must make the change the same store action
// makes from the menu, and nothing else. Before the fix Ctrl+Shift+V stacked a
// hidden copy that burned twice, PgUp / PgDn jogged the machine's Z and
// Alt+Shift+H / V distributed spacing.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { createProject, IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { installAbortShortcut } from '../laser/use-job-shortcuts';
import { installJogShortcuts } from '../laser/use-jog-shortcuts';
import { jogAxisSignsForOrigin } from '../../core/devices/jog-direction';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { undoStepName } from '../state/undo-step-names';
import { PlatformProvider } from './platform-context';
import { shapeObject } from './shortcuts-test-helpers';
import { useShortcuts } from './use-shortcuts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => false, requestPort: vi.fn(async () => null) },
};

function ShortcutHarness(): null {
  useShortcuts();
  return null;
}

const realStopJob = useLaserStore.getState().stopJob;
const stopJob = vi.fn(async () => undefined);
const onFocusJog = vi.fn();
const onXyJog = vi.fn();
let root: Root | null = null;
let uninstall: Array<() => void> = [];

// Three 20 x 10 mm rectangles at x 10, 50 and 120, the audit's fixture.
function rect(id: string, x: number): SceneObject {
  return { ...shapeObject({ ...IDENTITY_TRANSFORM, x, y: 10 }), id };
}

beforeEach(async () => {
  resetStore();
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      scene: { ...project.scene, objects: [rect('a', 10), rect('b', 50), rect('c', 120)] },
    },
  });
  useStore.getState().selectObject('a');
  useUiStore.setState({ modalDepth: 0, zoomFactor: 2 });
  stopJob.mockClear();
  onFocusJog.mockClear();
  onXyJog.mockClear();
  useLaserStore.setState({ stopJob });
  uninstall = [
    installAbortShortcut(window),
    installJogShortcuts(window, {
      focusDisabled: () => false,
      onFocusJog,
      xyDisabled: () => false,
      xyStep: () => ({ stepMm: 1, feed: 600, signs: jogAxisSignsForOrigin('front-left') }),
      onXyJog,
    }),
  ];
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={platform}>
        <ShortcutHarness />
      </PlatformProvider>,
    );
  });
});

afterEach(async () => {
  uninstall.forEach((remove) => remove());
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  useLaserStore.setState({ ...initialLaserState(), stopJob: realStopJob });
  resetStore();
});

async function press(init: KeyboardEventInit): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    document.body.dispatchEvent(event);
    await Promise.resolve();
  });
  return event;
}

function objects(): ReadonlyArray<SceneObject> {
  return useStore.getState().project.scene.objects;
}

function object(id: string): SceneObject {
  const found = objects().find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`Missing object ${id}`);
  return found;
}

function order(): string {
  return objects()
    .map((candidate) => candidate.id)
    .join('');
}

function lastUndoName(): string {
  const state = useStore.getState();
  const before = state.undoStack.at(-1);
  if (before === undefined) throw new Error('No undo step');
  return undoStepName(before, state.project);
}

/** What the store action alone does to a copy of the fixture, for comparison. */
function expectedAfter(run: () => void): ReadonlyArray<SceneObject> {
  const start = useStore.getState();
  run();
  const result = useStore.getState().project.scene.objects;
  useStore.setState({
    project: start.project,
    undoStack: start.undoStack,
    redoStack: start.redoStack,
    dirty: start.dirty,
  });
  return result;
}

describe('LightBurn flip and Paste in Place keys (L8-P2-1)', () => {
  it('Ctrl+Shift+V flips vertically, as the menu does, and adds nothing', async () => {
    const app = useStore.getState();
    app.copySelection();
    const expected = expectedAfter(() => useStore.getState().flipSelection('vertical'));

    const event = await press({ key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(objects()).toEqual(expected);
    expect(objects()).toHaveLength(3);
    expect(object('a').transform.mirrorY).not.toBe(app.project.scene.objects[0]?.transform.mirrorY);
    expect(lastUndoName()).toBe('Flip Vertical');
  });

  it('Ctrl+Shift+H flips horizontally', async () => {
    const expected = expectedAfter(() => useStore.getState().flipSelection('horizontal'));

    const event = await press({ key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(objects()).toEqual(expected);
    expect(lastUndoName()).toBe('Flip Horizontal');
  });

  it('Alt+V pastes in place: one copy on the copied artwork, one undo step', async () => {
    useStore.getState().copySelection();

    const event = await press({ key: 'v', code: 'KeyV', altKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(objects()).toHaveLength(4);
    const copy = objects()[3];
    expect(copy?.id).not.toBe('a');
    expect(copy?.transform.x).toBe(10);
    expect(copy?.transform.y).toBe(10);
    expect(useStore.getState().selectedObjectId).toBe(copy?.id);
    expect(lastUndoName()).toBe('Paste in Place');
  });
});

describe('LightBurn draw-order keys and the Z jog chord (L8-P2-3)', () => {
  it.each([
    ['PgUp', { key: 'PageUp', code: 'PageUp' }, 'bac', 'Bring Forward'],
    ['Ctrl+PgUp', { key: 'PageUp', code: 'PageUp', ctrlKey: true }, 'bca', 'Bring to Front'],
  ] as ReadonlyArray<[string, KeyboardEventInit, string, string]>)(
    '%s restacks the selection and never moves the machine',
    async (_name, init, restacked, undoName) => {
      const event = await press(init);

      expect(event.defaultPrevented).toBe(true);
      expect(order()).toBe(restacked);
      expect(lastUndoName()).toBe(undoName);
      expect(onFocusJog).not.toHaveBeenCalled();
      expect(onXyJog).not.toHaveBeenCalled();
    },
  );

  it('PgDn and Ctrl+PgDn send the selection backward and to the back', async () => {
    useStore.getState().selectObject('c');
    await press({ key: 'PageDown', code: 'PageDown' });
    expect(order()).toBe('acb');
    await press({ key: 'PageDown', code: 'PageDown', ctrlKey: true });
    expect(order()).toBe('cab');
    expect(lastUndoName()).toBe('Send to Back');
    expect(onFocusJog).not.toHaveBeenCalled();
  });

  it('Ctrl+Alt+PgUp / PgDn jog Z one step and leave the draw order alone', async () => {
    const up = await press({ key: 'PageUp', code: 'PageUp', ctrlKey: true, altKey: true });
    const down = await press({ key: 'PageDown', code: 'PageDown', ctrlKey: true, altKey: true });

    expect(onFocusJog.mock.calls).toEqual([[1], [-1]]);
    expect(up.defaultPrevented && down.defaultPrevented).toBe(true);
    expect(order()).toBe('abc');
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

describe('LightBurn Move Together keys (L8-P2-4)', () => {
  it('Alt+Shift+H moves the selection together side by side, not to equal gaps', async () => {
    useStore.getState().selectObjects(['a', 'b', 'c']);
    const expected = expectedAfter(() => useStore.getState().moveSelectionTogether('horizontal'));

    const event = await press({ key: 'H', code: 'KeyH', altKey: true, shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(objects()).toEqual(expected);
    // Distribute spacing would have put b at 65 (the audit's repro).
    expect(object('b').transform.x).not.toBe(65);
    expect(lastUndoName()).toBe('Move H Together');
  });

  it('Alt+Shift+V moves the selection together edge to edge', async () => {
    useStore.getState().selectObjects(['a', 'b', 'c']);
    const expected = expectedAfter(() => useStore.getState().moveSelectionTogether('vertical'));

    await press({ key: 'V', code: 'KeyV', altKey: true, shiftKey: true });

    expect(objects()).toEqual(expected);
    expect(lastUndoName()).toBe('Move V Together');
  });
});

describe('LightBurn rotate keys beside Abort (L8-P2-2)', () => {
  it.each([
    ['Shift+.', { key: '>', code: 'Period', shiftKey: true }, 45, 'Rotate 45° Clockwise'],
    [
      'Ctrl+Shift+,',
      { key: '<', code: 'Comma', shiftKey: true, ctrlKey: true },
      358.5,
      'Rotate 1.5° Counter-clockwise',
    ],
  ] as ReadonlyArray<[string, KeyboardEventInit, number, string]>)(
    '%s turns the selection',
    async (_name, init, rotationDeg, undoName) => {
      await press(init);

      expect(object('a').transform.rotationDeg).toBeCloseTo(rotationDeg, 9);
      expect(lastUndoName()).toBe(undoName);
      expect(stopJob).not.toHaveBeenCalled();
    },
  );

  it('keeps Ctrl+. as Abort during a job, and never turns the artwork with it', async () => {
    useLaserStore.setState({ streamer: step(createStreamer('G1 X1 S100')).state });

    const abort = await press({ key: '.', code: 'Period', ctrlKey: true });

    expect(abort.defaultPrevented).toBe(true);
    expect(stopJob).toHaveBeenCalledOnce();
    expect(object('a').transform.rotationDeg).toBe(0);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('turns 1.5° on Ctrl+Shift+. during a job without aborting it', async () => {
    useLaserStore.setState({ streamer: step(createStreamer('G1 X1 S100')).state });

    await press({ key: '>', code: 'Period', ctrlKey: true, shiftKey: true });

    expect(stopJob).not.toHaveBeenCalled();
    expect(object('a').transform.rotationDeg).toBeCloseTo(1.5, 9);
  });

  it('leaves idle Ctrl+. doing nothing, as before', async () => {
    const idle = await press({ key: '.', code: 'Period', ctrlKey: true });

    expect(idle.defaultPrevented).toBe(false);
    expect(stopJob).not.toHaveBeenCalled();
    expect(object('a').transform.rotationDeg).toBe(0);
  });
});

describe('Shift-typed + zoom and Ctrl+Y redo (L8-P2-7, L8-P3-9)', () => {
  it('zooms in on + typed with Shift, and leaves Alt++ (Boolean union) alone', async () => {
    const plus = await press({ key: '+', code: 'Equal', shiftKey: true });
    expect(plus.defaultPrevented).toBe(true);
    expect(useUiStore.getState().zoomFactor).toBeCloseTo(2.5, 9);

    const union = await press({ key: '+', code: 'Equal', shiftKey: true, altKey: true });
    expect(union.defaultPrevented).toBe(false);
    expect(useUiStore.getState().zoomFactor).toBeCloseTo(2.5, 9);
  });

  it('redoes with Ctrl+Y on the main canvas', async () => {
    await press({ key: 'h' });
    const flipped = useStore.getState().project;
    await press({ key: 'z', ctrlKey: true });
    expect(useStore.getState().project).not.toBe(flipped);

    const redo = await press({ key: 'y', ctrlKey: true });

    expect(redo.defaultPrevented).toBe(true);
    expect(useStore.getState().project).toEqual(flipped);
    expect(useStore.getState().redoStack).toHaveLength(0);
  });
});
