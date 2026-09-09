import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { machineKindOf, type LayerMode, type Project } from '../../core/scene';
import type { LayerDefaultSettings } from './layer-default-settings';

// Unverified historical proposal; see docs/proposals/2026-09-06-4040-layer-defaults.md.
const NEOTRONICS_4040_SPEED_MM_PER_MIN = 800;
const NEOTRONICS_4040_LINE_POWER_PERCENT = 90;
const NEOTRONICS_4040_FILL_POWER_PERCENT = 80;

export function profileLayerDefaultSettings(
  project: Pick<Project, 'device' | 'machine'>,
  mode: LayerMode,
  saved: LayerDefaultSettings = {},
): LayerDefaultSettings {
  if (machineKindOf(project.machine) !== 'laser') return {};
  if (project.device.profileId !== NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.profileId) return {};
  if (mode === 'image') return {};
  // Existing-operation mode changes only receive these three proposed fields.
  // Other saved fields retain their current fresh-operation-only behavior.
  return {
    speed: saved.speed ?? NEOTRONICS_4040_SPEED_MM_PER_MIN,
    power:
      saved.power ??
      (mode === 'line' ? NEOTRONICS_4040_LINE_POWER_PERCENT : NEOTRONICS_4040_FILL_POWER_PERCENT),
    fillBidirectional: saved.fillBidirectional ?? false,
  };
}
