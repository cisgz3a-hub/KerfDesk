// Keyboard shortcut handlers (WORKFLOW.md F-A15). Each category has its own
// handler and bindings table so individual functions stay small per ADR-015.
//
// Categories:
//   * File: Cmd/Ctrl+N, O, S, I, E
//   * Edit: Cmd/Ctrl+Z, Shift+Z, Delete/Backspace, Escape
//   * Transform: arrow keys (nudge), H/V (flip)
//   * View: P (preview toggle)

import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { Project, SceneObject, Transform } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import type { JobPlacementSettings, MachinePlacementSnapshot } from '../job-placement';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import {
  handleImportSvg,
  handleOpenProject,
  handleSaveGcode,
  handleSaveProject,
} from './file-actions';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { finishPen } from '../workspace/pen-tool';

const NUDGE_MM = 1;
const NUDGE_BIG_MM = 10;

export type FileCtx = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly importSvgObject: (obj: SceneObject, batchIdx?: number) => ImportOutcome;
  readonly setProject: (p: Project) => void;
  readonly newProject: () => void;
  readonly savedName: string | null;
  readonly jobPlacement: JobPlacementSettings;
  readonly machine: MachinePlacementSnapshot;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly lastSaveTarget: SaveTarget | null;
  readonly markSaved: (target: SaveTarget) => void;
  readonly markLoaded: (filename: string) => void;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  // F-A13 dirty-check. Resolves false to abort destructive actions (New /
  // Open). Wired in use-shortcuts.ts to the Save / Don't Save / Cancel
  // dialog flow (LU18); tests can stub an async true-returning fn.
  readonly confirmDiscard: (action: string) => Promise<boolean>;
};

export type EditCtx = {
  readonly undo: () => void;
  readonly redo: () => void;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly removeSceneObject: (id: string) => void;
  readonly selectObject: (id: string | null) => void;
  readonly selectAllObjects: () => void;
  readonly duplicateSelection: () => void;
  readonly resetToolMode: () => void;
};

export type TransformCtx = {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly applyObjectTransform: (id: string, transform: Transform) => void;
};

export type ViewCtx = {
  readonly togglePreview: () => void;
  readonly resetView: () => void; // F (fit) and 0 (100%) both call this in Phase A
  readonly zoomBy: (factor: number) => void;
  // Shift+F — zoom the viewport to the current selection's combined
  // bounding box. No-op when nothing's selected (falls through to the
  // default F behaviour at the call site? No — the binding skips so
  // the bare F keypress still fires next).
  readonly fitToSelection: () => void;
};

function hasMeta(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

function isEditableTarget(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (target === null) return false;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true;
  // Defensive: contenteditable + ARIA textbox surfaces. We don't ship any
  // today, but a future rich-text or jog-readout that opts into editing
  // would otherwise eat user keystrokes via the global handlers.
  // (Check both the property and the attribute — jsdom computes the
  // property differently from real browsers, and tests need the
  // attribute path to work.)
  if (target.isContentEditable) return true;
  const editableAttr = target.getAttribute('contenteditable');
  if (editableAttr !== null && editableAttr !== 'false') return true;
  if (target.getAttribute('role') === 'textbox') return true;
  return false;
}

const FILE_KEYS: ReadonlyArray<string> = ['n', 'o', 's', 'i', 'e'];
const FILE_DISPATCH: Readonly<Record<string, (c: FileCtx) => void>> = {
  n: (c) => {
    void c.confirmDiscard('start a new project').then((ok) => {
      if (ok) c.newProject();
    });
  },
  o: (c) => {
    void c.confirmDiscard('open another project').then((ok) => {
      if (!ok) return;
      return handleOpenProject({
        platform: c.platform,
        setProject: c.setProject,
        markLoaded: c.markLoaded,
        pushToast: c.pushToast,
      });
    });
  },
  s: (c) =>
    void handleSaveProject({
      platform: c.platform,
      project: c.project,
      savedName: c.savedName,
      lastSaveTarget: c.lastSaveTarget,
      markSaved: c.markSaved,
      pushToast: c.pushToast,
    }),
  i: (c) => void handleImportSvg(c.platform, c.importSvgObject, c.pushToast),
  e: (c) =>
    void handleSaveGcode({
      platform: c.platform,
      project: c.project,
      savedName: c.savedName,
      jobPlacement: c.jobPlacement,
      machine: c.machine,
      controllerSettings: c.controllerSettings,
      pushToast: c.pushToast,
    }),
};

export function handleFileShortcut(e: KeyboardEvent, ctx: FileCtx): boolean {
  if (!hasMeta(e)) return false;
  // Ctrl+Shift+S = Save As (F-A15); always opens the dialog.
  if (e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void handleSaveProject(
      {
        platform: ctx.platform,
        project: ctx.project,
        savedName: ctx.savedName,
        lastSaveTarget: ctx.lastSaveTarget,
        markSaved: ctx.markSaved,
        pushToast: ctx.pushToast,
      },
      true,
    );
    return true;
  }
  if (e.shiftKey) return false;
  const key = e.key.toLowerCase();
  if (!FILE_KEYS.includes(key)) return false;
  e.preventDefault();
  FILE_DISPATCH[key]?.(ctx);
  return true;
}

type EditBinding = {
  readonly match: (e: KeyboardEvent) => boolean;
  readonly invoke: (c: EditCtx) => void;
};

const EDIT_BINDINGS: ReadonlyArray<EditBinding> = [
  {
    match: (e) => hasMeta(e) && e.key.toLowerCase() === 'z' && !e.shiftKey,
    invoke: (c) => c.undo(),
  },
  {
    match: (e) => hasMeta(e) && e.key.toLowerCase() === 'z' && e.shiftKey,
    invoke: (c) => c.redo(),
  },
  {
    match: (e) => hasMeta(e) && e.key.toLowerCase() === 'a' && !e.shiftKey,
    invoke: (c) => c.selectAllObjects(),
  },
  {
    // Cmd/Ctrl+D — Duplicate selection. Matches Figma / Inkscape /
    // LightBurn. Skipped inside editable targets (the input-focus
    // guard at the top of handleEditShortcut handles that) so the
    // browser's bookmark-this-page default still fires when the user
    // is typing in a field rather than working with canvas objects.
    match: (e) => hasMeta(e) && e.key.toLowerCase() === 'd' && !e.shiftKey,
    invoke: (c) => c.duplicateSelection(),
  },
  {
    match: (e) => !hasMeta(e) && (e.key === 'Delete' || e.key === 'Backspace'),
    invoke: (c) => {
      // Multi-delete (F-A14 / F-A5). Remove the primary first, then every
      // extra. removeSceneObject auto-clears the matching selection so we
      // can iterate the captured set safely.
      const all = [
        ...(c.selectedObjectId !== null ? [c.selectedObjectId] : []),
        ...c.additionalSelectedIds,
      ];
      for (const id of all) c.removeSceneObject(id);
    },
  },
  {
    // Phase G (B6) — Enter finishes the pen's in-progress polyline as an OPEN
    // path. The penDraft guard lives in `match` (not `invoke`) because
    // handleEditShortcut preventDefaults BEFORE invoke runs; without it a bare
    // Enter anywhere would be swallowed. Gated on !previewMode so it can't
    // commit into a previewed scene.
    match: (e) => {
      // Re-check the pen is the active tool (not just that a draft exists), so a
      // leaked draft can never be committed from another mode — consistent with
      // the double-click finisher's guard.
      const ui = useUiStore.getState();
      return (
        !hasMeta(e) &&
        e.key === 'Enter' &&
        ui.toolMode.kind === 'draw' &&
        ui.toolMode.shape === 'polyline' &&
        ui.penDraft !== null &&
        !useStore.getState().previewMode
      );
    },
    invoke: () => {
      const s = useStore.getState();
      finishPen({ closed: false, project: s.project, drawShape: s.drawShape });
    },
  },
  {
    match: (e) => !hasMeta(e) && e.key === 'Escape',
    invoke: (c) => {
      // resetToolMode also clears any in-progress pen polyline (ADR-051 B6).
      c.resetToolMode(); // Esc always returns to the Select tool (ADR-051)
      c.selectObject(null);
    },
  },
];

export function handleEditShortcut(e: KeyboardEvent, ctx: EditCtx): boolean {
  // Editable targets get a hard pass — typing in a text input must let
  // Backspace delete characters, Cmd+A select the input's text, Cmd+Z
  // undo the input's edit history, etc. Without this guard the global
  // handlers eat Backspace (deletes the selected scene object) and
  // Cmd+A (selects every scene object), making text dialogs and
  // number inputs unusable. Mirrors the same check on
  // handleTransformShortcut / handleViewShortcut.
  if (isEditableTarget(e)) return false;
  for (const binding of EDIT_BINDINGS) {
    if (binding.match(e)) {
      e.preventDefault();
      binding.invoke(ctx);
      return true;
    }
  }
  return false;
}

const ARROW_DELTAS: Readonly<Record<string, { dx: number; dy: number }>> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

function tryNudge(e: KeyboardEvent, ctx: TransformCtx): boolean {
  const arrow = ARROW_DELTAS[e.key];
  if (arrow === undefined) return false;
  e.preventDefault();
  const obj = ctx.project.scene.objects.find((o) => o.id === ctx.selectedObjectId);
  if (obj === undefined) return true;
  const step = e.shiftKey ? NUDGE_BIG_MM : NUDGE_MM;
  ctx.applyObjectTransform(obj.id, {
    ...obj.transform,
    x: obj.transform.x + arrow.dx * step,
    y: obj.transform.y + arrow.dy * step,
  });
  return true;
}

function tryFlip(e: KeyboardEvent, ctx: TransformCtx): boolean {
  const key = e.key.toLowerCase();
  if (key !== 'h' && key !== 'v') return false;
  e.preventDefault();
  const obj = ctx.project.scene.objects.find((o) => o.id === ctx.selectedObjectId);
  if (obj === undefined) return true;
  const next: Transform = {
    ...obj.transform,
    mirrorX: key === 'h' ? !obj.transform.mirrorX : obj.transform.mirrorX,
    mirrorY: key === 'v' ? !obj.transform.mirrorY : obj.transform.mirrorY,
  };
  ctx.applyObjectTransform(obj.id, next);
  return true;
}

export function handleTransformShortcut(e: KeyboardEvent, ctx: TransformCtx): boolean {
  if (ctx.selectedObjectId === null) return false;
  if (hasMeta(e) || e.altKey) return false;
  if (isEditableTarget(e)) return false;
  if (tryNudge(e, ctx)) return true;
  if (tryFlip(e, ctx)) return true;
  return false;
}

// Shift+F = fit-to-selection. Pulled out of handleViewShortcut so
// the parent function stays under the cyclomatic-complexity lint cap.
function tryShiftFitToSelection(e: KeyboardEvent, ctx: ViewCtx): boolean {
  if (!e.shiftKey || hasMeta(e)) return false;
  if (e.key.toLowerCase() !== 'f') return false;
  e.preventDefault();
  ctx.fitToSelection();
  return true;
}

export function handleViewShortcut(e: KeyboardEvent, ctx: ViewCtx): boolean {
  if (isEditableTarget(e)) return false;
  if (tryShiftFitToSelection(e, ctx)) return true;
  if (hasMeta(e) || e.shiftKey) return false;
  const key = e.key.toLowerCase();
  // F-A15 View shortcuts. Phase A treats F (fit) and 0 (100%) identically
  // since the only "100%" state we model is fit-to-bed; if a Phase C ADR
  // introduces real device-units zoom, '0' will diverge from F.
  switch (key) {
    case 'p':
      e.preventDefault();
      ctx.togglePreview();
      return true;
    case 'f':
    case '0':
      e.preventDefault();
      ctx.resetView();
      return true;
    case '+':
    case '=': // '=' is shift-less '+', the literal key in most keyboards
      e.preventDefault();
      ctx.zoomBy(1.25);
      return true;
    case '-':
      e.preventDefault();
      ctx.zoomBy(1 / 1.25);
      return true;
    default:
      return false;
  }
}
