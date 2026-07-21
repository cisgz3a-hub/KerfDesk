// Step 3: optional boundaries and calibrations, every group headed by a live
// one-line status so the whole machine state reads without opening anything
// (ADR-239). Editors stay draft-bound; no live project state or hardware
// command changes when a field is edited.

import { DEFAULT_ROTARY_SETUP, type DeviceProfile } from '../../../core/devices';
import { scanOffsetMagnitudeLimitMm } from '../../../core/devices/scan-offset-profile';
import { AutofocusEditor } from '../AutofocusEditor';
import { ZRows } from '../DeviceProfileRows';
import { SafetyZonesPanel } from '../MachineSetupSafetyZones';
import { PlannerFields } from '../PlannerAdvanced';
import { ScanOffsetEditor } from '../ScanOffsetEditor';
import { ControlledLaserOffTravelRow } from '../ControlledLaserOffTravelRow';
import {
  autofocusStatus,
  cameraStatus,
  noGoZoneStatus,
  plannerStatus,
  rotaryStatus,
  scanOffsetStatus,
  zAxisStatus,
} from './device-setup-option-status';
import { DeviceSetupRotaryFields } from './DeviceSetupRotaryFields';
import { deviceSetupSupportsMachineKind, type DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupOptionsStep({
  state,
  dispatch,
  openAutofocus,
}: DeviceSetupStepProps & { readonly openAutofocus?: boolean }): JSX.Element {
  const draft = state.draft;
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  return (
    <section style={sectionStyle}>
      <div style={introStyle}>
        <strong>Options and calibration — everything here is optional.</strong>
        <span>
          Each row shows its current state, so nothing needs opening just to check it. Safety zones
          are enforced by job, frame, export, resume, and bounded jog checks; the other features
          stay off or uncalibrated until configured.
        </span>
      </div>
      <OptionSection title="No-go zones" status={noGoZoneStatus(draft)}>
        <SafetyZonesPanel zones={draft.noGoZones} onChange={(noGoZones) => update({ noGoZones })} />
      </OptionSection>
      <OptionSection title="Z axis and probe" status={zAxisStatus(draft)}>
        <ZRows device={draft} update={update} />
        <p style={mutedStyle}>
          Recording a probe does not run a probe cycle. Work-zero probing remains a separate,
          supervised hardware operation after setup is saved.
        </p>
      </OptionSection>
      <OptionSection title="Planner and time estimate" status={plannerStatus(draft)}>
        <PlannerFields
          accel={draft.accelMmPerSec2}
          jd={draft.junctionDeviationMm}
          cutTimeScale={draft.estimateCutTimeScale ?? 1}
          travelTimeScale={draft.estimateTravelTimeScale ?? 1}
          onAccelChange={(accelMmPerSec2) => update({ accelMmPerSec2 })}
          onJdChange={(junctionDeviationMm) => update({ junctionDeviationMm })}
          onCutTimeScaleChange={(estimateCutTimeScale) => update({ estimateCutTimeScale })}
          onTravelTimeScaleChange={(estimateTravelTimeScale) => update({ estimateTravelTimeScale })}
        />
      </OptionSection>
      {deviceSetupSupportsMachineKind(state, 'laser') ? (
        <LaserCalibrationSections
          draft={draft}
          update={update}
          openAutofocus={openAutofocus === true}
        />
      ) : null}
    </section>
  );
}

function LaserCalibrationSections(props: {
  readonly draft: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
  readonly openAutofocus: boolean;
}): JSX.Element {
  const { draft, update } = props;
  return (
    <>
      <OptionSection title="Raster scan-offset calibration" status={scanOffsetStatus(draft)}>
        <ScanOffsetEditor
          value={draft.scanningOffsets}
          maxOffsetMagnitudeMm={scanOffsetMagnitudeLimitMm(draft)}
          onChange={(scanningOffsets) =>
            update({
              scanningOffsets,
              scanOffsetCalibrationStatus: scanningOffsets.length > 0 ? 'pending' : undefined,
            })
          }
        />
        <ControlledLaserOffTravelRow
          value={draft.controlledLaserOffTravelFeedMmPerMin}
          maxFeed={draft.maxFeed}
          onChange={(controlledLaserOffTravelFeedMmPerMin) =>
            update({ controlledLaserOffTravelFeedMmPerMin })
          }
        />
        <p style={mutedStyle}>
          Controlled seek travel is an expert motion policy. It keeps the laser off but can add
          substantial return time, especially for one-way engraving.
        </p>
      </OptionSection>
      <OptionSection
        title="Auto-focus setup"
        status={autofocusStatus(draft)}
        open={props.openAutofocus}
      >
        <AutofocusEditor
          value={draft.autofocusCommand}
          onChange={(autofocusCommand) => update({ autofocusCommand })}
        />
      </OptionSection>
      <OptionSection title="Rotary attachment" status={rotaryStatus(draft)}>
        <DeviceSetupRotaryFields
          value={draft.rotary ?? DEFAULT_ROTARY_SETUP}
          onChange={(rotary) => update({ rotary })}
        />
      </OptionSection>
      <OptionSection title="Camera" status={cameraStatus(draft)}>
        <CameraStatusBody profile={draft} />
      </OptionSection>
    </>
  );
}

function OptionSection(props: {
  readonly title: string;
  readonly status: string;
  readonly open?: boolean;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <details open={props.open === true} style={detailsStyle}>
      <summary style={summaryStyle} title={`Show or hide ${props.title}. Current: ${props.status}`}>
        <span>{props.title}</span>
        <span style={summaryStatusStyle}>{props.status}</span>
      </summary>
      <div style={bodyStyle}>{props.children}</div>
    </details>
  );
}

function CameraStatusBody({ profile }: { readonly profile: DeviceProfile }): JSX.Element {
  return (
    <>
      <dl style={definitionStyle}>
        <dt>Camera profile</dt>
        <dd>{profile.cameraProfile === undefined ? 'Not selected' : 'Configured'}</dd>
        <dt>Lens calibration</dt>
        <dd>{profile.cameraCalibration === undefined ? 'Pending' : 'Saved'}</dd>
        <dt>Bed alignment</dt>
        <dd>{profile.cameraAlignment === undefined ? 'Pending' : 'Saved'}</dd>
      </dl>
      <p style={mutedStyle}>
        Camera capture and four-point alignment require the live camera view, so use Camera Setup
        after saving this machine draft. Existing calibration remains attached to the profile.
      </p>
    </>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const introStyle: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12, lineHeight: 1.45 };
const detailsStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 8,
};
// display stays list-item so the native disclosure triangle keeps signaling
// expandability; the status floats right like the old auto-focus badge.
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12, fontWeight: 600 };
const summaryStatusStyle: React.CSSProperties = {
  float: 'right',
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  fontWeight: 500,
  textAlign: 'right',
};
const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 8,
};
const mutedStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.45,
};
const definitionStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '120px minmax(0, 1fr)',
  gap: '5px 10px',
  fontSize: 12,
};
