export const PRO_FEATURES = [
  'box_generator',
  'nesting',
  'variable_text',
   'material_test',
  'cross_hatch',
  'job_replay',
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
