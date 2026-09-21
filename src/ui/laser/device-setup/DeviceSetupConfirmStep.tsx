// Essentials: establish the software
// coordinate model used by the workspace, bounds checks, framing, jogging,
// and output transforms.

import type { DeviceProfile, Origin } from '../../../core/devices';
import { BedRows, FeedRows, NameRow, OriginCornerRow, OriginSelect } from '../DeviceProfileFields';
import { Row } from '../device-settings-shared';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { machineSetupControllerGuide } from './machine-setup-controller-guide';

export function DeviceSetupConfirmStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  const guide = machineSetupControllerGuide(
    state.draft.controllerKind ?? 'grbl-v1.1',
    state.draft.controllerCommandSet,
  );
  const sourceText = state.detectedApplied
    ? 'Using the controller values you applied. Check them against your machine.'
    : 'Check these values against your machine or its manual.';
  return (
    <section className="lf-setup-fields" style={sectionStyle}>
      <div style={calloutStyle}>
        <strong>Work area and coordinates</strong>
        <span>{sourceText}</span>
      </div>
      <NameRow device={state.draft} update={update} />
      <BedRows device={state.draft} update={update} />
      <OriginCornerRow device={state.draft} update={update} />
      <Row label="Homing">
        <label style={inlineStyle}>
          <input
            type="checkbox"
            checked={state.draft.homing.enabled}
            disabled={guide.homeCommand === null}
            onChange={(event) =>
              update({ homing: { ...state.draft.homing, enabled: event.target.checked } })
            }
            aria-label="Homing enabled"
            title="Enable Home only after physical switches, axis direction, and the homing corner are verified."
          />
          <span>
            {guide.homeCommand === null
              ? 'Not available for this controller'
              : `Enable Home (${guide.homeCommand})`}
          </span>
        </label>
        {state.draft.homing.enabled ? (
          <OriginSelect
            value={state.draft.homing.direction}
            onChange={(direction: Origin) =>
              update({ homing: { ...state.draft.homing, direction } })
            }
          />
        ) : null}
      </Row>
      <p style={warningStyle}>
        Enable Home only after checking your switches and homing direction. Saving does not run
        Home.
      </p>
      <details className="lf-setup-disclosure lf-setup-disclosure--nested">
        <summary title="Adjust the output feed limit and framing speed for this machine.">
          <span>Travel speeds</span>
          <small>{state.draft.maxFeed} mm/min output limit</small>
        </summary>
        <div className="lf-setup-disclosure-body">
          <FeedRows device={state.draft} update={update} />
          <p className="lf-setup-muted">
            Output speed limits generated jobs. Frame speed is a separate request.
          </p>
        </div>
      </details>
    </section>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const calloutStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 12,
  lineHeight: 1.45,
  marginBottom: 2,
};
const inlineStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 12,
};
const warningStyle: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 12,
  color: 'var(--lf-warning-fg)',
  lineHeight: 1.45,
};
