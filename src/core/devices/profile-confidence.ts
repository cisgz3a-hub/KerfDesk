import type { DeviceProfile, ProfileEvidenceStatus } from './device-profile';

export type ProfileConfidenceLabel =
  | 'Hardware verified'
  | 'Simulator tested'
  | 'Public-spec starter'
  | 'Experimental'
  | 'Default starter'
  | 'Imported / custom';

const PROFILE_CONFIDENCE_LABELS: Record<ProfileEvidenceStatus, ProfileConfidenceLabel> = {
  'default-starter': 'Default starter',
  'hardware-verified': 'Hardware verified',
  'simulator-tested': 'Simulator tested',
  'public-spec-starter': 'Public-spec starter',
  experimental: 'Experimental',
  'user-imported': 'Imported / custom',
  default: 'Default starter',
  researched: 'Simulator tested',
  unverified: 'Public-spec starter',
};

export function profileConfidenceLabel(profile: DeviceProfile): ProfileConfidenceLabel {
  const status = profile.evidence?.[0]?.status;
  return status === undefined ? 'Imported / custom' : PROFILE_CONFIDENCE_LABELS[status];
}
