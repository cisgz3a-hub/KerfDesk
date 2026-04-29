export const PRO_FEATURES = [
  // 'box_generator' moved to free: finger-joint box generation is
  // beginner-friendly and belongs in easy mode without a pro gate.
  'nesting',
  'variable_text',
   'material_test',
  'cross_hatch',
  // T1-88: 'job_replay' removed. Capture is a diagnostic tool for support
  // and is now always-on (free + Pro). When a viewer/export UI is built,
  // it can add its own Pro gate (e.g. 'job_replay_viewer') at that time.
  'power_scale',
  'cut_start_point',
  'overcut',
  'lead_in',
  'tabs',
  'text_to_path',
  'boolean_ops',
  'kerf_wizard',
] as const;

export type ProFeature = (typeof PRO_FEATURES)[number];

export type EntitlementTier = 'developer' | 'tester_permanent' | 'paid' | 'trial' | 'free';

export interface EntitlementState {
  tier: EntitlementTier;
  hasPro: boolean;
  label?: string;
  code?: string;
  daysLeft?: number;
  expired?: boolean;
}

/** Persisted Gumroad-side cache shape (localStorage JSON). */
export interface StoredLicenseCacheEntry {
  code: string;
  name: string;
  validatedAt: number;
  valid: boolean;
}
