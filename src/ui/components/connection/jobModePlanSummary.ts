// T1-62: for multi-mode jobs, generic "Running" hides the planned
// operation order from the user during a 12+ minute mixed engrave+cut
// run. PlanOptimizer's `orderOperations` always emits engrave/score
// first, then cuts (see `src/core/plan/OperationOrderer.ts:176-191`),
// regardless of layer order. This helper surfaces that fixed sequence
// as a "Plan: ..." subtitle under the active label so the user knows
// what's coming. Image layers map to engrave (treated identically by
// the planner). Returns null for the single-mode or no-objects cases
// — the existing activeLabel already names the operation there.
import type { Scene } from '../../../core/scene/Scene';
import type { LayerMode } from '../../../core/scene/Layer';

const PLAN_ORDER: ReadonlyArray<{ mode: LayerMode; label: string }> = [
  { mode: 'engrave', label: 'Engrave' },
  { mode: 'score', label: 'Score' },
  // Image layers compile through the same engrave path as `engrave`
  // mode; surface them under the same label rather than introducing a
  // separate "Image" step that would mislead the user.
  { mode: 'image', label: 'Engrave' },
  { mode: 'cut', label: 'Cut' },
];

export function jobModePlanSummary(scene: Scene): string | null {
  const outputLayers = scene.layers.filter(l => l.visible && l.output !== false);
  const hasObjectsByLayer = new Set(
    scene.objects.filter(o => o.visible).map(o => o.layerId),
  );
  const contributing = outputLayers.filter(l => hasObjectsByLayer.has(l.id));
  if (contributing.length === 0) return null;
  const modes = new Set(contributing.map(l => l.settings.mode));
  if (modes.size <= 1) return null;
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const { mode, label } of PLAN_ORDER) {
    if (modes.has(mode) && !seen.has(label)) {
      ordered.push(label);
      seen.add(label);
    }
  }
  // After the engrave/image label coalescing, the deduped count can
  // drop back to 1 (e.g. an `engrave` layer plus an `image` layer →
  // both render as "Engrave"). In that case the activeLabel already
  // says "Engraving" and a single-step plan summary would be noise.
  if (ordered.length <= 1) return null;
  return ordered.join(' → ');
}
