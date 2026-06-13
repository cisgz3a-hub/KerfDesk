import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import type { ImportOutcome } from '../state/store';
import { handleEditShortcut, handleFileShortcut, handleViewShortcut } from './shortcuts';

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: {
    isSupported: () => false,
    requestPort: vi.fn(async () => null),
  },
};

function fileCtx(
  overrides: Partial<Parameters<typeof handleFileShortcut>[1]> = {},
): Parameters<typeof handleFileShortcut>[1] {
  return {
    platform: mockPlatform,
    project: createProject(),
    importSvgObject: vi.fn((): ImportOutcome => ({ kind: 'added' })),
    setProject: vi.fn(),
    newProject: vi.fn(),
    savedName: null,
    jobPlacement: DEFAULT_JOB_PLACEMENT,
    machine: { statusReport: null, workOriginActive: false, wcoCache: null },
    controllerSettings: null,
    lastSaveTarget: null,
    markSaved: vi.fn(),
    markLoaded: vi.fn(),
    pushToast: vi.fn(),
    confirmDiscard: vi.fn(async () => true),
    ...overrides,
  };
}

describe('handleFileShortcut - LightBurn-compatible Save G-code binding', () => {
  it('leaves Ctrl+E free for the future Ellipse tool instead of exporting G-code', () => {
    const event = fakeKeydown({ key: 'e', ctrlKey: true });

    expect(handleFileShortcut(event, fileCtx())).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('handles Alt+Shift+L as Save G-code', () => {
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const event = fakeKeydown({ key: 'l', altKey: true, shiftKey: true });

    expect(handleFileShortcut(event, fileCtx())).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });
});

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
    ...overrides,
  };
}

function fakeKeydown(opts: {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly target?: HTMLElement | null;
}): KeyboardEvent {
  // jsdom's KeyboardEvent constructor handles modifier flags; manually
  // assign target since the constructor doesn't accept it.
  const e = new KeyboardEvent('keydown', {
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
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
