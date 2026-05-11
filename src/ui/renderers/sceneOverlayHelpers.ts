/**
 * T1-132: pure geometry helpers extracted from `SceneRenderer.ts` to
 * support the machine-origin overlay rendering. Pre-T1-132 these five
 * helpers (`computeSceneBounds`, `hasSceneBounds`, `positiveFinite`,
 * `resolveBedOriginMarker`, `resolveMachineOriginMarker`) lived as
 * private top-level functions inside the 1381-line `SceneRenderer.ts`
 * file. They are pure — no canvas, no React, no side effects — but
 * exercising them required loading the renderer module (which pulls in
 * `getImage`, `ImageStore`, dispatchEvent, etc.).
 *
 * Hoisting them to a sibling module:
 *   - lets each helper be unit-tested in isolation with no DOM
 *   - shrinks `SceneRenderer.ts` by ~100 lines
 *   - groups the overlay-bounds logic so the next slice (the dither /
 *     image cache subsystem) is easier to isolate next
 *
 * No behavioral change — `SceneRenderer.renderMachineOriginOverlay` and
 * `renderSceneBackground` call the same pure functions; the only
 * difference is they're imported instead of co-located.
 *
 * NOTE: a separate `computeSceneBounds` exists in
 * `src/geometry/bounds.ts` with a different filter rule (it skips
 * objects on invisible layers; the renderer version filters by object
 * visibility only). The two are intentionally separate — see the
 * comment block in `src/geometry/bounds.ts` lines 94-96.
 */
import type { Scene } from '../../core/scene/Scene';
import { computeObjectBounds } from '../../geometry/bounds';
import { transformPointToMachine } from '../../core/plan/MachineTransform';
import type { MachineOriginCorner } from '../../core/devices/DeviceProfile';

/**
 * Axis-aligned bounding rectangle in scene (canvas) coordinates.
 * Structurally compatible with `AABB` but used only by the overlay
 * renderer's local computation.
 */
export type SceneBounds = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * Shared overlay options used by `renderSceneBackground` and the
 * machine-origin marker resolver. Field set is identical to
 * `SceneMachineOverlayOptions` in `SceneRenderer.ts` — re-exported here
 * so the helper module can be imported standalone in tests.
 */
export interface SceneMachineOverlayOptions {
  /** Current G-code start mode -- controls which anchor marker is drawn. */
  startMode?: 'absolute' | 'current' | 'savedOrigin';
  /** Saved origin in canvas coordinates for saved-origin mode. */
  savedOrigin?: { x: number; y: number } | null;
  /** Physical bed size in mm, retained for callers that share machine overlay options. */
  bedWidthMm?: number;
  bedHeightMm?: number;
  /** Machine origin corner, retained for callers that share machine overlay options. */
  originCorner?: MachineOriginCorner;
}

/**
 * Marker drawn at the machine-origin reference point of the current
 * start mode. Labels are stable strings that the overlay renderer
 * prints next to the cross-hair.
 */
export interface MachineOriginMarker {
  x: number;
  y: number;
  label: 'Bed origin' | 'Head start' | 'Saved zero';
}

/** Fallback bed height when no machine profile data is wired in. */
export const DEFAULT_MACHINE_OVERLAY_BED_HEIGHT_MM = 300;

/**
 * Compute the union AABB of visible scene objects (NOT filtered by
 * layer visibility — see file header for the rationale).
 * Returns {0,0,0,0} when no visible object has finite bounds.
 */
export function computeSceneBounds(scene: Scene): SceneBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of scene.objects) {
    if (!obj.visible) continue;
    const b = computeObjectBounds(obj);
    if (!b || !Number.isFinite(b.minX) || !Number.isFinite(b.minY) || !Number.isFinite(b.maxX) || !Number.isFinite(b.maxY)) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return { minX, minY, maxX, maxY };
}

/**
 * True if `sceneBounds` carries finite extents AND covers a non-zero
 * region (at least one of width / height is strictly positive).
 * A degenerate rectangle (all corners collapsed onto a point) is
 * treated as "no bounds" so the overlay renderer can skip the
 * head-start anchor.
 */
export function hasSceneBounds(sceneBounds: SceneBounds): boolean {
  return (
    Number.isFinite(sceneBounds.minX) &&
    Number.isFinite(sceneBounds.minY) &&
    Number.isFinite(sceneBounds.maxX) &&
    Number.isFinite(sceneBounds.maxY) &&
    (sceneBounds.maxX !== sceneBounds.minX || sceneBounds.maxY !== sceneBounds.minY)
  );
}

/** Returns `value` when finite and strictly positive, else `null`. */
export function positiveFinite(value: number | undefined): number | null {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : null;
}

/**
 * Resolve the canvas-space coordinates of the bed-origin marker for
 * the "absolute" start mode. Tries every bed corner and picks the one
 * that transforms to the minimum-magnitude machine coordinate — that
 * is the corner the user has configured as machine origin.
 *
 * Returns `null` when origin is on the right but `bedWidthMm` is not
 * known (the X-mirror calculation needs the bed width). The other
 * three configurations (front-left, rear-left, no override) fall back
 * to `DEFAULT_MACHINE_OVERLAY_BED_HEIGHT_MM` for the Y axis.
 */
export function resolveBedOriginMarker(options: SceneMachineOverlayOptions): MachineOriginMarker | null {
  const originCorner = options.originCorner ?? 'front-left';
  const bedHeightMm = positiveFinite(options.bedHeightMm) ?? DEFAULT_MACHINE_OVERLAY_BED_HEIGHT_MM;
  const bedWidthMm = positiveFinite(options.bedWidthMm);

  if ((originCorner === 'front-right' || originCorner === 'rear-right') && bedWidthMm == null) {
    return null;
  }

  const transformOptions = {
    startMode: 'absolute' as const,
    savedOrigin: null,
    originCorner,
    bedHeightMm,
    ...(bedWidthMm != null ? { bedWidthMm } : {}),
  };
  const transformBounds = {
    minX: 0,
    minY: 0,
    maxX: bedWidthMm ?? 0,
    maxY: bedHeightMm,
  };
  const candidates = [
    { x: 0, y: 0 },
    { x: 0, y: bedHeightMm },
    ...(bedWidthMm != null
      ? [
          { x: bedWidthMm, y: 0 },
          { x: bedWidthMm, y: bedHeightMm },
        ]
      : []),
  ];

  let best = candidates[0];
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const machine = transformPointToMachine(candidate, transformBounds, transformOptions);
    const score = Math.abs(machine.x) + Math.abs(machine.y);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return { x: best.x, y: best.y, label: 'Bed origin' };
}

/**
 * Dispatch to the right marker based on the active start mode.
 *
 *   - absolute      → bed-origin corner (delegated to resolveBedOriginMarker)
 *   - current       → top-left of scene bounds (head sits there at start)
 *   - savedOrigin   → the saved origin point if one is configured
 *
 * Returns `null` when the required input for the active mode is
 * missing (e.g. saved origin not set, scene empty in current mode).
 */
export function resolveMachineOriginMarker(
  sceneBounds: SceneBounds,
  options: SceneMachineOverlayOptions,
): MachineOriginMarker | null {
  switch (options.startMode) {
    case 'absolute':
      return resolveBedOriginMarker(options);
    case 'current':
      if (!hasSceneBounds(sceneBounds)) return null;
      return { x: sceneBounds.minX, y: sceneBounds.minY, label: 'Head start' };
    case 'savedOrigin':
      if (!options.savedOrigin) return null;
      return { x: options.savedOrigin.x, y: options.savedOrigin.y, label: 'Saved zero' };
    default:
      return null;
  }
}
