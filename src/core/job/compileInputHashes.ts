/**
 * T1-181 (external audit High #1 + #3): determinism gate for the
 * compile → start contract.
 *
 * The audit framed the problem as: "the same scene can compile into
 * different toolpaths depending on license state or whichever profile
 * singleton is active at compile time" and "user compiles a job,
 * profile changes, entitlement state changes, material curve changes,
 * or preset storage changes; the job preview and final output can
 * diverge from what the user thought they approved."
 *
 * The full audit-recommended refactor — pass immutable
 * `CompileInputSnapshot` snapshots through `JobCompiler` so it never
 * reads global state — is multi-day blast-radius work. T1-181 ships
 * the minimal-but-meaningful determinism gate FIRST: hash the
 * compile-time inputs that drive output divergence, attach the
 * hashes to the `ValidatedJobTicket`, and recompute / verify at
 * start time. If any input changed between compile and start, the
 * ticket validator refuses to start, surfacing the divergence to
 * the user instead of silently executing stale output.
 *
 * Two NEW input dimensions this module hashes (alongside the
 * existing sceneHash / profileHash / gcodeHash):
 *
 *   1. `EntitlementPolicySnapshot` — the 6 boolean feature flags
 *      that `JobCompiler.createEntitlementPolicy()` reads from
 *      `canUseFeature()` at compile time. Flags: `allowTabs`,
 *      `allowOvercut`, `allowLeadIn`, `allowCrossHatch`,
 *      `allowPowerScale`, `allowCutStartPoint`. A change in license
 *      state between compile and start could mean: the compile
 *      dropped tabs (license expired), then license is restored,
 *      then the user clicks start and the running G-code lacks the
 *      tabs they think they enabled. Hashing catches this.
 *
 *   2. `MaterialPresetsHash` — a hash of every material preset
 *      referenced by any scene layer at compile time. The hash
 *      covers the preset's full definition (powerMin / powerMax /
 *      speed / responseCurve / etc), not just the ID, because the
 *      preset CONTENT can mutate (user edits a preset between
 *      compile and start). Hashing catches this.
 *
 * The hashes are part of the public ticket surface; the validator
 * recomputes them from the live state.
 */
import { canUseFeature } from '../../entitlements';
import { getPresetById } from '../materials/MaterialLibrary';
import type { Scene } from '../scene/Scene';
import { hashObject, hashString } from './ticketHashing';

/**
 * Snapshot of the 6 boolean feature flags read by
 * `JobCompiler.createEntitlementPolicy` at compile time. Captured at
 * compile time and again at start time; mismatch ⇒ entitlement state
 * changed and the compile output may no longer reflect user intent.
 *
 * The `droppedFeatures: Set<string>` field on the runtime
 * `EntitlementPolicy` is intentionally NOT part of this snapshot —
 * it's populated DURING compile (mutated as the compiler decides
 * which features to drop based on these flags), so it's a COMPILE
 * OUTPUT, not a compile INPUT.
 */
export interface EntitlementPolicySnapshot {
  readonly allowTabs: boolean;
  readonly allowOvercut: boolean;
  readonly allowLeadIn: boolean;
  readonly allowCrossHatch: boolean;
  readonly allowPowerScale: boolean;
  readonly allowCutStartPoint: boolean;
}

/**
 * Capture the current entitlement-policy snapshot. Calls
 * `canUseFeature()` for each of the six flags at the time of
 * invocation. The compile path captures once; the validator
 * captures again at start time and compares hashes.
 */
export function captureEntitlementPolicySnapshot(): EntitlementPolicySnapshot {
  return {
    allowTabs: canUseFeature('tabs'),
    allowOvercut: canUseFeature('overcut'),
    allowLeadIn: canUseFeature('lead_in'),
    allowCrossHatch: canUseFeature('cross_hatch'),
    allowPowerScale: canUseFeature('power_scale'),
    allowCutStartPoint: canUseFeature('cut_start_point'),
  };
}

/** Hash an entitlement-policy snapshot for ticket attribution. */
export function hashEntitlementPolicy(snapshot: EntitlementPolicySnapshot): string {
  return hashObject(snapshot);
}

/**
 * Collect the IDs of every material preset referenced by any layer
 * in the scene. A layer with no `materialPresetId` (or null) is
 * skipped; this is the legacy "no preset linked" path that compiles
 * deterministically from the layer's own settings.
 */
function collectReferencedPresetIds(scene: Scene): string[] {
  const ids = new Set<string>();
  for (const layer of scene.layers ?? []) {
    // materialPresetId lives on `LaserSettings`, not on `Layer` directly.
    const id = layer.settings?.materialPresetId;
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * Hash every material preset referenced by the scene at the time of
 * capture. Captures the preset's full definition (not just ID), so a
 * preset mutation between compile and start is detected. Missing
 * preset IDs hash as the literal `'<missing>'` so a delete-between-
 * compile-and-start is also caught (the live capture sees missing
 * preset; the recorded hash sees the present preset).
 *
 * Ordering: the preset IDs are sorted before hashing so the hash is
 * deterministic regardless of layer insertion order.
 */
export function hashReferencedMaterialPresets(scene: Scene): string {
  const ids = collectReferencedPresetIds(scene);
  if (ids.length === 0) return hashString('no-material-presets');
  const entries = ids.map(id => {
    const preset = getPresetById(id);
    return {
      id,
      preset: preset ?? '<missing>',
    };
  });
  return hashObject(entries);
}
