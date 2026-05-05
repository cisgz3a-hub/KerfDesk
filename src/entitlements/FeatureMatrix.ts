/**
 * T2-91: central feature-enforcement registry. Pre-T2-91 each Pro
 * feature was gated at zero, one, or several layers, with no central
 * declaration of "where MUST this be checked." That is exactly how
 * box_generator originally shipped without a service-level gate
 * (T1-79 added it later) — UI hid the button but the underlying
 * generator was callable from any code path.
 *
 * `FEATURE_MATRIX` declares, for every Pro feature, the layers at
 * which enforcement must occur. The companion test
 * `tests/feature-matrix-enforcement.test.ts` source-scans the repo to
 * verify every declaration is satisfied — adding a feature to the
 * matrix without wiring its gates fails CI.
 *
 * Dependencies of intent: pairs with T1-78 (canUseFeature/assertFeature
 * split) and T2-92 (per-feature granular canUse). T2-91 is the
 * declarative layer; T1-78 + T2-92 are the runtime layer.
 */
import type { ProFeature } from './types';

/**
 * The four layers at which feature enforcement can occur.
 *
 * - `ui` — button/menu hidden or shows an upgrade affordance. Cosmetic
 *   only; UI gates can be bypassed by code paths that don't go through
 *   the disabled control. Required for discoverability ("you can't
 *   click what you can't see"); never the only gate.
 * - `service` — the geometry/operation entrypoint calls
 *   `assertFeature()` and throws when the user lacks the feature.
 *   Defends against any caller (UI, plugin, devtools) reaching the
 *   feature.
 * - `compiler` — `JobCompiler` reads `canUseFeature()` and clears the
 *   feature flag in the compiled job (e.g. `allowTabs`, `allowOvercut`,
 *   `allowLeadIn`). Prevents the feature from affecting the emitted
 *   G-code even if the scene has the data.
 * - `export` — SVG / `.laserforge.json` export omits the feature's data
 *   (or watermarks the file). Belongs to features whose value is in
 *   the artifact a user shares.
 */
export type EnforcementLayer = 'ui' | 'service' | 'compiler' | 'export';

export interface FeatureDefinition {
  id: ProFeature;
  /** User-facing label (toolbar, paywall dialog, license matrix). */
  label: string;
  /** Tier required. Today only `pro`; reserved for future plans. */
  tier: 'pro';
  /** Layers at which enforcement MUST occur. T2-91 test verifies. */
  enforcement: ReadonlyArray<EnforcementLayer>;
  description: string;
}

/**
 * The 12 Pro features in `PRO_FEATURES`, each with the layer(s) at
 * which enforcement must exist. Order matches `PRO_FEATURES` for
 * audit-friendliness.
 *
 * Note: `box_generator` is intentionally NOT in this matrix — it was
 * moved to free in `types.ts` (beginner-friendly entry feature). When
 * a Pro feature is added or removed from `PRO_FEATURES`, this matrix
 * must be updated; the tests verify the matrix matches the type.
 */
export const FEATURE_MATRIX: ReadonlyArray<FeatureDefinition> = [
  {
    id: 'nesting',
    label: 'Auto-nesting',
    tier: 'pro',
    enforcement: ['ui', 'service'],
    description: 'Automatically arrange shapes to minimise material waste.',
  },
  {
    id: 'variable_text',
    label: 'Variable text',
    tier: 'pro',
    enforcement: ['ui', 'service'],
    description: 'Per-instance variable substitution in text objects (numbering, names).',
  },
  {
    id: 'material_test',
    label: 'Material test grid',
    tier: 'pro',
    enforcement: ['ui', 'service'],
    description: 'Generate a power/speed parameter sweep grid for material tuning.',
  },
  {
    id: 'cross_hatch',
    label: 'Cross-hatch fill',
    tier: 'pro',
    enforcement: ['ui', 'compiler'],
    description: 'Diagonal cross-hatch fill pattern for engraves.',
  },
  {
    id: 'power_scale',
    label: 'Per-segment power scaling',
    tier: 'pro',
    enforcement: ['ui', 'compiler'],
    description: 'Modulate laser power along a path segment by stroke value.',
  },
  {
    id: 'cut_start_point',
    label: 'Cut start point',
    tier: 'pro',
    enforcement: ['ui', 'compiler'],
    description: 'User-controlled cut start point per closed path.',
  },
  {
    id: 'overcut',
    label: 'Overcut',
    tier: 'pro',
    enforcement: ['ui', 'compiler'],
    description: 'Extend cuts past the closing point to ensure full kerf release.',
  },
  {
    id: 'lead_in',
    label: 'Lead-in',
    tier: 'pro',
    enforcement: ['ui', 'compiler'],
    description: 'Tangent or perpendicular lead-in segments before each cut.',
  },
  {
    id: 'tabs',
    label: 'Cut tabs',
    tier: 'pro',
    enforcement: ['ui', 'compiler'],
    description: 'Hold-down tabs to keep parts in the sheet during cutting.',
  },
  {
    id: 'text_to_path',
    label: 'Text to path',
    tier: 'pro',
    enforcement: ['ui', 'service'],
    description: 'Convert text objects to outline geometry (releases the font).',
  },
  {
    id: 'boolean_ops',
    label: 'Boolean operations',
    tier: 'pro',
    enforcement: ['ui', 'service'],
    description: 'Union / difference / intersection on closed paths.',
  },
  {
    id: 'kerf_wizard',
    label: 'Kerf wizard',
    tier: 'pro',
    enforcement: ['ui', 'service'],
    description: 'Guided kerf-measurement workflow that derives kerf from a cut test.',
  },
];

/** Lookup helper. */
export function getFeatureDefinition(id: ProFeature): FeatureDefinition | null {
  return FEATURE_MATRIX.find((f) => f.id === id) ?? null;
}

/** All features that must have a gate at the given layer. */
export function featuresEnforcedAt(layer: EnforcementLayer): ReadonlyArray<FeatureDefinition> {
  return FEATURE_MATRIX.filter((f) => f.enforcement.includes(layer));
}

/**
 * Returns the JobCompiler `allow*` flag name for a compiler-enforced
 * feature. Mirrors the convention in `JobCompiler.ts`:
 *   tabs            → allowTabs
 *   cross_hatch     → allowCrossHatch
 *   cut_start_point → allowCutStartPoint
 */
export function compilerAllowFlagName(id: ProFeature): string {
  const camel = id.replace(/_(\w)/g, (_, c) => (c as string).toUpperCase());
  return `allow${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}
