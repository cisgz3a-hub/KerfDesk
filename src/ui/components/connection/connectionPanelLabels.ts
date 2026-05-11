/**
 * T1-143: pure label / formatting / scene-summary helpers extracted
 * from the 2674-line `ConnectionPanelMain.tsx`. These were already
 * top-level functions in the file (so pure), but loading them
 * required pulling in the panel's massive import surface
 * (controllers, preflight, electron bridge, etc.). Hoisting them to
 * a sibling helper module:
 *
 *   - lets each function be unit-tested in isolation
 *   - documents the user-facing label strings as a stable surface
 *     (operator-visible "Cutting" / "Engraving" / "Use canvas
 *     position" copy is part of the contract)
 *   - clears space in the panel for the next slice
 *
 * Functions in this module are pure — no `this`, no DOM, no
 * singletons. Same shape as `buildStartReadiness` (T1-129) which is
 * also a sibling pure helper.
 */
import { sortLayersByProcessingOrder, type LayerMode } from '../../../core/scene/Layer';
import type { Scene } from '../../../core/scene/Scene';
import type { GcodeStartMode } from '../../../core/output/GcodeOrigin';
import type { FrameResult } from '../../../app/ExecutionCoordinator';
import { describeFrameFailure } from '../../../app/FrameResultMessages';
import type { OperationKind, OperationRow } from '../../../app/OperationOrder';

/**
 * Build the live-job "mode" label shown in the running banner.
 * If every output layer with visible objects shares a single mode,
 * return that mode's gerund (`Cutting` / `Engraving` / `Scoring`).
 * Image-mode layers report as `Engraving` (image is just engrave at
 * the operator-language level). Mixed-mode jobs fall back to
 * `Running`. Returns `Running` when there are no contributing layers.
 */
export function jobModeLabel(scene: Scene): string {
  const outputLayers = scene.layers.filter((l) => l.visible && l.output !== false);
  const hasObjectsByLayer = new Set(
    scene.objects.filter((o) => o.visible).map((o) => o.layerId),
  );
  const contributing = outputLayers.filter((l) => hasObjectsByLayer.has(l.id));

  if (contributing.length === 0) return 'Running';

  const modes = new Set(contributing.map((l) => l.settings.mode));
  if (modes.size > 1) return 'Running';

  const onlyMode = modes.values().next().value as LayerMode;
  switch (onlyMode) {
    case 'cut': return 'Cutting';
    case 'engrave': return 'Engraving';
    case 'score': return 'Scoring';
    case 'image': return 'Engraving';
    default: return 'Running';
  }
}

/** Format a seconds value as `M:SS` for the running-job timer. */
export function formatJobTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/**
 * Operator-facing label for the gcode start-mode dropdown. Maps:
 *   - absolute    → "Use canvas position"
 *   - current     → "Start from laser head"
 *   - savedOrigin → "Use saved zero point"
 */
export function readyStartModeLabel(mode: GcodeStartMode): string {
  switch (mode) {
    case 'absolute': return 'Use canvas position';
    case 'current': return 'Start from laser head';
    case 'savedOrigin': return 'Use saved zero point';
  }
}

/** Image layers count as engrave operations at the user-visible level. */
export function layerModeToOperationKind(mode: LayerMode): OperationKind {
  return mode === 'image' ? 'image' : mode;
}

/**
 * Build the rows shown in the "Ready to run" operation list. One row
 * per contributing visible+output layer (objects, sorted in
 * processing order via `sortLayersByProcessingOrder`). Layers with
 * no visible objects are skipped — they wouldn't contribute any
 * burn moves.
 */
export function buildReadyOperationRows(scene: Scene): OperationRow[] {
  const visibleObjectCounts = new Map<string, number>();
  for (const object of scene.objects) {
    if (!object.visible) continue;
    visibleObjectCounts.set(object.layerId, (visibleObjectCounts.get(object.layerId) ?? 0) + 1);
  }

  const layers = sortLayersByProcessingOrder(
    scene.layers.filter((layer) => layer.visible && layer.output !== false),
  );
  const rows: OperationRow[] = [];
  for (const layer of layers) {
    if ((visibleObjectCounts.get(layer.id) ?? 0) === 0) continue;
    rows.push({
      index: rows.length + 1,
      layerName: layer.name || `Layer ${layer.id.slice(0, 4)}`,
      kind: layerModeToOperationKind(layer.settings.mode),
      powerPercent: Math.round(layer.settings.power.max),
      feedRateMmPerMin: Math.round(layer.settings.speed),
      passes: Math.max(1, Math.round(layer.settings.passes)),
    });
  }
  return rows;
}

/**
 * Compose the structured-log line for a frame failure. Calls
 * `describeFrameFailure` for the user-facing copy and prepends the
 * warning glyph + appends the `details` line when present.
 */
export function frameFailureLogLine(
  result: FrameResult,
  frameLabel: string,
  idleTimeoutSeconds?: number,
): string {
  const description = describeFrameFailure(result, frameLabel, idleTimeoutSeconds);
  const details = description.details ? ` Details: ${description.details}` : '';
  return `⚠ ${description.title}: ${description.message} ${description.recovery}${details}`;
}
