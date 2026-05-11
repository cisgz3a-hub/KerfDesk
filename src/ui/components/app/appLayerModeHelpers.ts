/**
 * T2-6 Phase 3v: pure layer-mode derivation helpers extracted from
 * App.tsx. Pre-phase-3v two memoized derivations lived inside the
 * App component:
 *
 *   - `activeLayerMode(scene)`: the mode of the scene's active
 *     layer, falling back to the first layer's mode, falling back
 *     to `'cut'`. Drives the mode tab indicator in the toolbar.
 *   - `interactableLayerIds(scene)`: every layer ID that shares the
 *     active layer's mode. Drives the canvas's
 *     interaction-eligibility filter — when the user picks
 *     "Engrave" mode, only engrave-mode layers respond to clicks /
 *     drag.
 *
 * Pure functions over Scene shape. Hoisting them lets the active /
 * fallback rules be tested with synthetic scenes and clears two
 * useMemo bodies from App.
 */
import type { Scene } from '../../../core/scene/Scene';
import type { LayerMode } from '../../../core/scene/Layer';

/**
 * Mode of the active layer; falls back to first layer's mode; falls
 * back to `'cut'` when the scene has no layers at all (defensive —
 * a real scene always has at least one layer).
 */
export function activeLayerMode(scene: Scene): LayerMode {
  const layer = scene.layers.find((l) => l.id === scene.activeLayerId);
  return layer?.settings.mode ?? scene.layers[0]?.settings.mode ?? 'cut';
}

/**
 * Set of every layer ID that shares the active layer's mode. The
 * canvas only treats objects on layers in this set as eligible for
 * click/drag interaction; everything else is locked from
 * mode-switch perspective so users can't accidentally select an
 * engrave shape while in cut mode.
 */
export function interactableLayerIds(scene: Scene): Set<string> {
  const mode = activeLayerMode(scene);
  return new Set(
    scene.layers.filter((l) => l.settings.mode === mode).map((l) => l.id),
  );
}
