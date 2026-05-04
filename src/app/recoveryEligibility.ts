// T1-71: pure predicate that decides whether an autosave payload is worth
// surfacing the recovery prompt for. Previously App.tsx only checked
// `scene.objects.length > 0`, which silently dropped recovery-worthy work
// like 13 minutes of bed/material/profile/layer setup the user did before
// placing their first object. Broadened to any of: objects, custom layers
// (more than the single default `Cut` layer), a populated material block,
// or a populated machine block. Malformed JSON returns false because
// there is nothing meaningful to restore — T1-70 covers the case where a
// user clicks Recover on partly-broken data and needs to see why it failed.

export interface RecoveryEligibility {
  shouldOffer: boolean;
  /** Subset that fires; useful for diagnostics + future "what's recoverable" UI. */
  reasons: ReadonlyArray<'objects' | 'customLayers' | 'material' | 'machine'>;
}

export function evaluateRecoveryEligibility(autosaveJson: string): RecoveryEligibility {
  let parsed: unknown;
  try {
    parsed = JSON.parse(autosaveJson);
  } catch {
    return { shouldOffer: false, reasons: [] };
  }
  const scene = (parsed as { scene?: unknown } | null)?.scene as
    | {
        objects?: unknown;
        layers?: unknown;
        material?: unknown;
        machine?: unknown;
      }
    | undefined;
  if (!scene || typeof scene !== 'object') {
    return { shouldOffer: false, reasons: [] };
  }
  const reasons: Array<'objects' | 'customLayers' | 'material' | 'machine'> = [];
  if (Array.isArray(scene.objects) && scene.objects.length > 0) reasons.push('objects');
  // The default scene has exactly one layer (`Cut`). Anything beyond that
  // — a renamed layer, an extra layer, custom power/speed — is real setup
  // work worth recovering.
  if (Array.isArray(scene.layers) && scene.layers.length > 1) reasons.push('customLayers');
  if (scene.material != null) reasons.push('material');
  if (scene.machine != null) reasons.push('machine');
  return { shouldOffer: reasons.length > 0, reasons };
}
