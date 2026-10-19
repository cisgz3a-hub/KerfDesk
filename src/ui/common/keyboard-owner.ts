import { isModalOpen, useUiStore } from '../state/ui-store';
import { useCanvasTextStore } from '../text/canvas-text-store';

/** A modal or an on-canvas text session owns the keyboard; workspace shortcuts
 *  and hover keys stand down until it closes. */
export function keyboardOwnedElsewhere(): boolean {
  return isModalOpen(useUiStore.getState()) || useCanvasTextStore.getState().session !== null;
}

/** Jig mode (ADR-638) replaces the main canvas, and its page handles the canvas
 *  keys itself; the main canvas's tool, edit and view shortcuts stand down. */
export function canvasKeysOwnedByJig(): boolean {
  return useUiStore.getState().registrationPanelOpen;
}
