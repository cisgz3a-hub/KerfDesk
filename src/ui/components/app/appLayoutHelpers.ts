/**
 * T2-6 Phase 3w: pure layout + connection-status helpers extracted
 * from App.tsx. Pre-phase-3w these computations lived inline in
 * App:
 *
 *   - `isLaserConnected(machineState)`: derives whether the toolbar
 *     should show "connected" UI. The predicate excludes
 *     `disconnected` and `connecting` statuses (the latter avoids a
 *     premature "connected" badge during the connect handshake).
 *   - `computeLayoutWidths(canvasWidth, connectionSidebarOpen)`:
 *     compute the connection sidebar / layers panel / toolbar /
 *     viewport widths from the total canvas width and the
 *     connection-sidebar-open flag. The sidebar caps at 500px or
 *     45% of canvas width (whichever is smaller); the layers panel
 *     is hidden when the connection sidebar is open (mutual
 *     exclusion) because both share the right-side gutter.
 *
 * Pure: no React, no DOM, no store reads. Hoisting lets the
 * layout math + sidebar-precedence rule be tested with synthetic
 * widths.
 */
import type { MachineState } from '../../../controllers/ControllerInterface';

/**
 * Returns true when the toolbar should show "laser connected"
 * status. False when the machine state is null, missing, or in the
 * pre-handshake `disconnected` / `connecting` phases.
 */
export function isLaserConnected(machineState: MachineState | null | undefined): boolean {
  return !!machineState
    && machineState.status !== 'disconnected'
    && machineState.status !== 'connecting';
}

/** Result of the layout-width computation. */
export interface AppLayoutWidths {
  /** Pixel width of the connection sidebar (0 when collapsed). */
  connectionSidebarWidth: number;
  /** Pixel width of the layers panel (0 when connection sidebar open). */
  layersPanelWidth: number;
  /** Pixel width of the left-side tool palette. Always 36. */
  toolbarWidth: number;
  /** Remaining width for the canvas viewport. */
  canvasViewportWidth: number;
}

const TOOLBAR_WIDTH_PX = 36;
const LAYERS_PANEL_WIDTH_PX = 240;
const CONNECTION_SIDEBAR_MAX_PX = 500;
const CONNECTION_SIDEBAR_PCT_OF_CANVAS = 0.45;

/**
 * Lay out the App's primary horizontal regions.
 *
 *   - Toolbar (left): fixed 36px.
 *   - Connection sidebar (right): when open, capped at min(500px,
 *     45% of canvas width). When closed, 0px.
 *   - Layers panel (right): 240px when the connection sidebar is
 *     closed; 0px when the sidebar is open (mutual exclusion —
 *     both occupy the right gutter).
 *   - Viewport: whatever's left.
 *
 * No clamping of the viewport at 0 — if the canvas is too narrow to
 * fit all the chrome, the consumer can decide what to do (the
 * underlying CSS layout in practice ensures a minimum window
 * size).
 */
export function computeLayoutWidths(
  canvasWidth: number,
  connectionSidebarOpen: boolean,
): AppLayoutWidths {
  const connectionSidebarWidth = connectionSidebarOpen
    ? Math.min(
        CONNECTION_SIDEBAR_MAX_PX,
        Math.floor(canvasWidth * CONNECTION_SIDEBAR_PCT_OF_CANVAS),
      )
    : 0;
  const layersPanelWidth = connectionSidebarOpen ? 0 : LAYERS_PANEL_WIDTH_PX;
  const toolbarWidth = TOOLBAR_WIDTH_PX;
  const canvasViewportWidth =
    canvasWidth - toolbarWidth - connectionSidebarWidth - layersPanelWidth;
  return { connectionSidebarWidth, layersPanelWidth, toolbarWidth, canvasViewportWidth };
}
