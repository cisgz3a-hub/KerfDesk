export const STORAGE_NAMESPACES = [
  'deviceProfiles',
  'materials',
  'autosave',
  'jobLogs',
  'replays',
  'entitlements',
  'diagnostics',
  'settings',
] as const;

export type StorageNamespace = typeof STORAGE_NAMESPACES[number];

interface NamespaceRule {
  namespace: StorageNamespace;
  exact?: readonly string[];
  prefixes?: readonly string[];
}

const STORAGE_NAMESPACE_RULES: readonly NamespaceRule[] = [
  {
    namespace: 'deviceProfiles',
    exact: ['laserforge_active_profile'],
    prefixes: ['laserforge_device_profile', 'deviceProfile_'],
  },
  {
    namespace: 'materials',
    exact: ['laserforge_user_materials', 'laserforge_material_feedback'],
    prefixes: ['laserforge_material', 'materialPreset_'],
  },
  {
    namespace: 'autosave',
    prefixes: ['laserforge_autosave'],
  },
  {
    namespace: 'jobLogs',
    prefixes: ['laserforge_job_log', 'joblog_'],
  },
  {
    namespace: 'replays',
    prefixes: ['laserforge_replay', 'replay_'],
  },
  {
    namespace: 'entitlements',
    exact: ['laserforge_pro'],
    prefixes: ['laserforge_license'],
  },
  {
    namespace: 'diagnostics',
    prefixes: ['laserforge_history', 'laserforge_correlation', 'laserforge_error'],
  },
  {
    namespace: 'settings',
    prefixes: [
      'laserforge_settings',
      'laserforge_window',
      'laserforge_user_mode',
      'laserforge_production_mode',
      'laserforge_start_mode',
      'laserforge_saved_origin',
      'laserforge_setup_complete',
      'laserforge_camera_calibration',
      'laserforge_falcon_last_ip',
      'laserforge_frame_dot_acknowledged',
      'laserforge_testfire_acknowledged',
      'laserforge_kerf',
      'laserforge_box_library_prefs',
      'laserforge_unsafe_prior_state',
    ],
  },
];

export function isStorageKeyAllowed(namespace: StorageNamespace, key: string): boolean {
  const rule = STORAGE_NAMESPACE_RULES.find(candidate => candidate.namespace === namespace);
  if (!rule) return false;
  return (rule.exact?.includes(key) ?? false)
    || (rule.prefixes?.some(prefix => key.startsWith(prefix)) ?? false);
}
