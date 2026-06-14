import { describe, expect, it, vi } from 'vitest';
import {
  handleEditShortcut,
  handleToolShortcut,
  handleTransformShortcut,
  handleViewShortcut,
} from './shortcuts';
import {
  applyTransform,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
  type Transform,
} from '../../core/scene';

// Minimal stub for the EditCtx so each test only spies on the action it
// cares about. Anything that fires unexpectedly trips its assertion.
function editCtx(
  overrides: Partial<Parameters<typeof handleEditShortcut>[1]> = {},
): Parameters<typeof handleEditShortcut>[1] {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    selectedObjectId: 'O1',
    additionalSelectedIds: new Set<string>(),
    removeSceneObject: vi.fn(),
    selectObject: vi.fn(),
    selectAllObjects: vi.fn(),
    duplicateSelection: vi.fn(),
    resetToolMode: vi.fn(),
    ...overrides,
  };
}

function fakeKeydown(opts: {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly target?: HTMLElement | null;
}): KeyboardEvent {
  // jsdom's KeyboardEvent constructor handles modifier flags; manually
  // assign target since the constructor doesn't accept it.
  const e = new KeyboardEvent('keydown', {
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (opts.target !== undefined) {
    Object.defineProperty(e, 'target', { value: opts.target, configurable: true });
  }
  return e;
}

describe('handleEditShortcut — input-focus guard (regression)', () => {
  it('Backspace inside an <input> does NOT trigger remove (user types text)', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ctx = editCtx();
    handleEditShortcut(fakeKeydown({ key: 'Backspace', target: input }), ctx);
    expect(ctx.removeSceneObject).not.toHaveBeenCalled();
    input.remove();
  });

  it('Backspace outside an input DOES trigger remove on the selection', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const ctx = editCtx();
    handleEditShortcut(fakeKeydown({ key: 'Backspace', target: div }), ctx);
    expect(ctx.removeSceneObject).toHaveBeenCalledWith('O1');
    div.remove();
  });

  it('Cmd+A inside a <textarea> does NOT select all scene objects', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const ctx = editCtx();
    handleEditShortcut(fakeKeydown({ key: 'a', metaKey: true, target: ta }), ctx);
    expect(ctx.selectAllObjects).not.toHaveBeenCalled();
    ta.remove();
  });

  it('Cmd+Z inside an <input> does NOT trigger project undo (input owns its undo)', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ctx = editCtx();
    handleEditShortcut(fakeKeydown({ key: 'z', ctrlKey: true, target: input }), ctx);
    expect(ctx.undo).not.toHaveBeenCalled();
    input.remove();
  });

  it('contenteditable target is also treated as editable', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    const ctx = editCtx();
    handleEditShortcut(fakeKeydown({ key: 'Backspace', target: div }), ctx);
    expect(ctx.removeSceneObject).not.toHaveBeenCalled();
    div.remove();
  });
});

describe('handleEditShortcut — Cmd+D duplicate', () => {
  it('Cmd+D on the canvas triggers duplicateSelection', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const ctx = editCtx();
    const handled = handleEditShortcut(fakeKeydown({ key: 'd', metaKey: true, target: div }), ctx);
    expect(handled).toBe(true);
    expect(ctx.duplicateSelection).toHaveBeenCalled();
    div.remove();
  });

  it('Cmd+D inside an <input> does NOT duplicate (browser keeps Bookmark)', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ctx = editCtx();
    const handled = handleEditShortcut(
      fakeKeydown({ key: 'd', metaKey: true, target: input }),
      ctx,
    );
    expect(handled).toBe(false);
    expect(ctx.duplicateSelection).not.toHaveBeenCalled();
    input.remove();
  });
});

describe('handleViewShortcut — Shift+F fit-to-selection', () => {
  it('Shift+F outside an input dispatches fitToSelection', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const fitToSelection = vi.fn();
    const handled = handleViewShortcut(fakeKeydown({ key: 'f', shiftKey: true, target: div }), {
      togglePreview: vi.fn(),
      resetView: vi.fn(),
      zoomBy: vi.fn(),
      fitToSelection,
    });
    expect(handled).toBe(true);
    expect(fitToSelection).toHaveBeenCalled();
    div.remove();
  });

  it('Shift+F inside an input does NOT fit (let the user type a capital F)', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const fitToSelection = vi.fn();
    handleViewShortcut(fakeKeydown({ key: 'F', shiftKey: true, target: input }), {
      togglePreview: vi.fn(),
      resetView: vi.fn(),
      zoomBy: vi.fn(),
      fitToSelection,
    });
    expect(fitToSelection).not.toHaveBeenCalled();
    input.remove();
  });

  it('plain F still hits resetView (the no-modifier path is unchanged)', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const resetView = vi.fn();
    handleViewShortcut(fakeKeydown({ key: 'f', target: div }), {
      togglePreview: vi.fn(),
      resetView,
      zoomBy: vi.fn(),
      fitToSelection: vi.fn(),
    });
    expect(resetView).toHaveBeenCalled();
    div.remove();
  });
});

describe('handleViewShortcut — input-focus guard (regression check)', () => {
  it('"+" inside an <input> does NOT zoom (so the user can type "+1")', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const zoomBy = vi.fn();
    handleViewShortcut(fakeKeydown({ key: '+', target: input }), {
      togglePreview: vi.fn(),
      resetView: vi.fn(),
      zoomBy,
      fitToSelection: vi.fn(),
    });
    expect(zoomBy).not.toHaveBeenCalled();
    input.remove();
  });
});

describe('handleToolShortcut — LightBurn tool arming (ADR-051 B7)', () => {
  it('Ctrl+E arms the Ellipse tool', () => {
    const setToolMode = vi.fn();
    const handled = handleToolShortcut(fakeKeydown({ key: 'e', ctrlKey: true }), { setToolMode });
    expect(handled).toBe(true);
    expect(setToolMode).toHaveBeenCalledWith({ kind: 'draw', shape: 'ellipse' });
  });

  it('Ctrl+R arms the Rectangle tool', () => {
    const setToolMode = vi.fn();
    handleToolShortcut(fakeKeydown({ key: 'r', ctrlKey: true }), { setToolMode });
    expect(setToolMode).toHaveBeenCalledWith({ kind: 'draw', shape: 'rect' });
  });

  it('Ctrl+L arms the pen (polyline) tool', () => {
    const setToolMode = vi.fn();
    handleToolShortcut(fakeKeydown({ key: 'l', ctrlKey: true }), { setToolMode });
    expect(setToolMode).toHaveBeenCalledWith({ kind: 'draw', shape: 'polyline' });
  });

  it('Ctrl+Shift+E does NOT arm a tool (that combo is export G-code)', () => {
    const setToolMode = vi.fn();
    const handled = handleToolShortcut(fakeKeydown({ key: 'e', ctrlKey: true, shiftKey: true }), {
      setToolMode,
    });
    expect(handled).toBe(false);
    expect(setToolMode).not.toHaveBeenCalled();
  });

  it('a bare key without Ctrl/Cmd does not arm a tool', () => {
    const setToolMode = vi.fn();
    const handled = handleToolShortcut(fakeKeydown({ key: 'e' }), { setToolMode });
    expect(handled).toBe(false);
    expect(setToolMode).not.toHaveBeenCalled();
  });

  it('Ctrl+E inside an <input> does NOT arm a tool (user is typing)', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const setToolMode = vi.fn();
    handleToolShortcut(fakeKeydown({ key: 'e', ctrlKey: true, target: input }), { setToolMode });
    expect(setToolMode).not.toHaveBeenCalled();
    input.remove();
  });

  it('Ctrl+K (unbound) is not handled', () => {
    const setToolMode = vi.fn();
    const handled = handleToolShortcut(fakeKeydown({ key: 'k', ctrlKey: true }), { setToolMode });
    expect(handled).toBe(false);
  });
});

describe('handleTransformShortcut — flip keeps object position', () => {
  it('H flips the selected object horizontally around its center', () => {
    const object = shapeObject({
      x: 40,
      y: 25,
      scaleX: 1.5,
      scaleY: 0.75,
      rotationDeg: 90,
      mirrorX: false,
      mirrorY: false,
    });
    const project = projectWithObject(object);
    const before = transformedCenter(object);
    const applyObjectTransform = vi.fn();

    const handled = handleTransformShortcut(fakeKeydown({ key: 'h' }), {
      project,
      selectedObjectId: object.id,
      applyObjectTransform,
    });

    expect(handled).toBe(true);
    expect(applyObjectTransform).toHaveBeenCalledTimes(1);
    const next = applyObjectTransform.mock.calls[0]?.[1] as Transform;
    const after = transformedCenter({ ...object, transform: next });
    expect(next.mirrorX).toBe(true);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

function projectWithObject(object: SceneObject): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects: [object] } };
}

function shapeObject(transform: Transform): SceneObject {
  return {
    kind: 'shape',
    id: 'shape-1',
    spec: { kind: 'rect', widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, ...transform },
    paths: [],
  };
}

function transformedCenter(object: SceneObject): { readonly x: number; readonly y: number } {
  return applyTransform(
    {
      x: (object.bounds.minX + object.bounds.maxX) / 2,
      y: (object.bounds.minY + object.bounds.maxY) / 2,
    },
    object.transform,
  );
}
