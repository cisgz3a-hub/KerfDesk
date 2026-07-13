// Step 4 of the Device Setup wizard: homing plus the optional/advanced editors
// ($H, Z, scan offsets, autofocus, planner tuning). All reuse the shared
// field components bound to the wizard draft.

import type { DeviceProfile } from '../../../core/devices';
import { AutofocusEditor } from '../AutofocusEditor';
import { Row } from '../device-settings-shared';
import { HomingEditor, NameRow, OriginCornerRow } from '../DeviceProfileFields';
import { AirAssistRow } from '../DeviceProfilePowerFields';
import { ZRows } from '../DeviceProfileRows';
import { PlannerAdvanced } from '../PlannerAdvanced';
import { ScanOffsetEditor } from '../ScanOffsetEditor';
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupSafetyStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const draft = state.draft;
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  return (
    <section style={sectionStyle}>
      <p style={hintStyle}>
        Name this machine and set what $$ cannot report — origin corner, air output, and homing.
        Enable $H only if your controller has working homing switches.
      </p>
      <NameRow device={draft} update={update} />
      <OriginCornerRow device={draft} update={update} />
      <AirAssistRow device={draft} update={update} />
      <Row label="Homing">
        <HomingEditor
          enabled={draft.homing.enabled}
          direction={draft.homing.direction}
          onChange={(homing) => update({ homing })}
        />
      </Row>
      <details style={advancedStyle}>
        <summary
          style={summaryStyle}
          title="Optional tuning: powered Z, autofocus, scan-offset compensation, and planner acceleration."
        >
          Advanced (optional)
        </summary>
        <div style={advancedBodyStyle}>
          <ZRows device={draft} update={update} />
          <ScanOffsetEditor
            value={draft.scanningOffsets}
            onChange={(scanningOffsets) => update({ scanningOffsets })}
          />
          <AutofocusEditor
            value={draft.autofocusCommand}
            onChange={(autofocusCommand) => update({ autofocusCommand })}
          />
          <PlannerAdvanced
            accel={draft.accelMmPerSec2}
            jd={draft.junctionDeviationMm}
            cutTimeScale={draft.estimateCutTimeScale ?? 1}
            travelTimeScale={draft.estimateTravelTimeScale ?? 1}
            onAccelChange={(accelMmPerSec2) => update({ accelMmPerSec2 })}
            onJdChange={(junctionDeviationMm) => update({ junctionDeviationMm })}
            onCutTimeScaleChange={(estimateCutTimeScale) => update({ estimateCutTimeScale })}
            onTravelTimeScaleChange={(estimateTravelTimeScale) =>
              update({ estimateTravelTimeScale })
            }
          />
        </div>
      </details>
    </section>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.4,
};
const advancedStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 6,
};
const summaryStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const advancedBodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginTop: 6,
};
