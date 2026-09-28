// The Job Review fact naming the fitted laser module, on a machine whose
// modules swap (ADR-503). KerfDesk cannot see which module is on the carriage,
// so the review says which one the job was prepared for.

import type { DeviceProfile } from '../../../core/devices';
import {
  fittedLaserModuleIndex,
  laserModuleLabel,
  laserModulesFor,
} from '../../../core/devices/laser-modules';
import type { JobReviewFact } from './job-review-live-rows';

export function laserModuleFacts(device: DeviceProfile): ReadonlyArray<JobReviewFact> {
  const modules = laserModulesFor(device);
  if (modules.length < 2) return [];
  const fitted = modules[fittedLaserModuleIndex(device)];
  if (fitted === undefined) {
    return [
      {
        label: 'Laser module',
        value: 'Not chosen · pick the fitted one under Laser module',
        tone: 'warning',
      },
    ];
  }
  return [
    {
      label: 'Laser module',
      value: `${laserModuleLabel(fitted)} · prepared for this one; check it is fitted`,
      tone: 'default',
    },
  ];
}
