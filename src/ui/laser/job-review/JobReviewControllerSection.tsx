// Collapsible read-only controller facts for the Job Review dialog
// (ADR-224): firmware, live state/position, active WCS, overrides, and the
// $$ settings that matter before a job ($32, $30, travel, homing, units).
// Live store reads — a disconnect or alarm while reviewing shows here.

import type { MachineKind } from '../../../core/scene';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import {
  buildControllerReviewFacts,
  controllerReviewSummary,
  type ControllerReviewArgs,
} from './job-review-live-rows';
import {
  detailsStyle,
  detailsSummaryStyle,
  factListStyle,
  mutedNoteStyle,
} from './job-review.styles';
import { JobReviewFactRow } from './JobReviewFactRow';

export function JobReviewControllerSection(props: {
  readonly machineKind: MachineKind;
}): JSX.Element {
  const args = useControllerReviewArgs(props.machineKind);
  const facts = buildControllerReviewFacts(args);
  return (
    <details style={detailsStyle}>
      <summary
        style={detailsSummaryStyle}
        title="Expand to review the live controller facts: firmware, state, position, WCS, overrides, and the $$ settings read this session."
      >
        Controller — {controllerReviewSummary(args)}
      </summary>
      {facts.length === 0 ? (
        <p style={mutedNoteStyle}>
          Not connected — live controller facts are unavailable. Connect before starting.
        </p>
      ) : (
        <dl style={factListStyle}>
          {facts.map((entry) => (
            <JobReviewFactRow key={entry.label} label={entry.label} tone={entry.tone}>
              {entry.value}
            </JobReviewFactRow>
          ))}
        </dl>
      )}
    </details>
  );
}

function useControllerReviewArgs(machineKind: MachineKind): ControllerReviewArgs {
  const isConnected = useLaserStore((s) => s.connection.kind === 'connected');
  const statusReport = useLaserStore((s) => s.statusReport);
  const alarmCode = useLaserStore((s) => s.alarmCode);
  const activeControllerKind = useLaserStore((s) => s.activeControllerKind);
  const detectedControllerKind = useLaserStore((s) => s.detectedControllerKind);
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const activeWcs = useLaserStore((s) => s.activeWcs);
  const overrides = useLaserStore((s) => s.ovCache);
  const profileMaxPowerS = useStore((s) => s.project.device.maxPowerS);
  const profileBedWidth = useStore((s) => s.project.device.bedWidth);
  const profileBedHeight = useStore((s) => s.project.device.bedHeight);
  return {
    isConnected,
    machineKind,
    statusReport,
    alarmCode,
    activeControllerKind,
    detectedControllerKind,
    controllerSettings,
    activeWcs,
    overrides,
    profileMaxPowerS,
    profileBedWidth,
    profileBedHeight,
  };
}
