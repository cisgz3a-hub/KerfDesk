// F-A15 View shortcuts, kept beside shortcuts.ts (which re-exports them) so that
// file stays inside the size cap:
//   * P (preview toggle), F and 0 (fit), Shift+F (fit to selection), F12 (side panels)
//   * + / = zoom in and - zoom out

import { isEditableShortcutTarget } from '../common/keyboard-targets';

export type ViewCtx = {
  readonly togglePreview: () => void;
  readonly resetView: () => void; // F (fit) and 0 (100%) both call this in Phase A
  readonly zoomBy: (factor: number) => void;
  // Shift+F — zoom the viewport to the current selection's combined
  // bounding box. No-op when nothing's selected (falls through to the
  // default F behaviour at the call site? No — the binding skips so
  // the bare F keypress still fires next).
  readonly fitToSelection: () => void;
  readonly toggleSidePanels: () => void;
};

const ZOOM_STEP = 1.25;
// '=' is shift-less '+', the literal key in most keyboards.
const ZOOM_KEYS: Readonly<Record<string, number>> = {
  '+': ZOOM_STEP,
  '=': ZOOM_STEP,
  '-': 1 / ZOOM_STEP,
};

function hasMeta(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey;
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

// The zoom keys go by the character typed: '+' is Shift+= on US and many other
// layouts, so Shift may come with it (ADR-499 Amendment 2). Alt with Shift is
// left alone, because Alt++ is LightBurn's Boolean union.
function tryZoomKey(e: KeyboardEvent, ctx: ViewCtx): boolean {
  const factor = ZOOM_KEYS[e.key];
  if (factor === undefined || hasMeta(e) || (e.shiftKey && e.altKey)) return false;
  e.preventDefault();
  ctx.zoomBy(factor);
  return true;
}

export function handleViewShortcut(e: KeyboardEvent, ctx: ViewCtx): boolean {
  if (isEditableShortcutTarget(e.target)) return false;
  if (tryToggleSidePanels(e, ctx)) return true;
  if (tryShiftFitToSelection(e, ctx)) return true;
  if (tryZoomKey(e, ctx)) return true;
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
    default:
      return false;
  }
}

function tryToggleSidePanels(e: KeyboardEvent, ctx: ViewCtx): boolean {
  if (e.key !== 'F12' || hasMeta(e) || e.altKey || e.shiftKey) return false;
  e.preventDefault();
  ctx.toggleSidePanels();
  return true;
}
