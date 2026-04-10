const PRO_FLAG_KEY = 'laserforge_pro';

export function isProUnlocked(): boolean {
  try {
    return localStorage.getItem(PRO_FLAG_KEY) === 'true';
  } catch {
    return false;
  }
}

const PRO_FEATURES = [
  'box_generator',
  'nesting',
  'variable_text',
  'material_test',
  'cross_hatch',
  'device_profiles',
  'job_replay',
  'power_scale',
  'cut_start_point',
  'overcut',
  'lead_in',
  'tabs',
  'text_to_path',
  'boolean_ops',
] as const;

export type ProFeature = typeof PRO_FEATURES[number];

export function checkProAccess(feature: ProFeature): boolean {
  void feature;
  return isProUnlocked();
}

/**
 * Show a paywall prompt if the feature is locked.
 * Returns true if user has access, false if they don't.
 */
export function gatedFeature(feature: ProFeature, onLockedAction?: () => void): boolean {
  if (isProUnlocked()) return true;
  if (onLockedAction) {
    onLockedAction();
  } else {
    // Default: show alert
    if (confirm('This is a PRO feature. Unlock LaserForge PRO for $30?\n\nClick OK to learn more.')) {
      window.open('/landing.html', '_blank');
    }
  }
  return false;
}
