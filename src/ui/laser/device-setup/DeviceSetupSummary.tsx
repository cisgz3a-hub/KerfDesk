import { useLaserStore } from '../../state/laser-store';
import type { DeviceSetupState } from './device-setup-flow';
import { machineSetupControllerGuide } from './machine-setup-controller-guide';

export function DeviceSetupSummary({ state }: { readonly state: DeviceSetupState }): JSX.Element {
  const connection = useLaserStore((s) => s.connection.kind);
  const guide = machineSetupControllerGuide(
    state.draft.controllerKind ?? 'grbl-v1.1',
    state.draft.controllerCommandSet,
  );
  const mode =
    state.machineKinds.length === 2 ? 'Laser + CNC' : state.machineKind === 'cnc' ? 'CNC' : 'Laser';
  const status =
    guide.transportLabel !== 'USB serial'
      ? 'File export'
      : connection === 'connected'
        ? 'Connected'
        : connection === 'connecting'
          ? 'Connecting…'
          : 'Offline setup';
  return (
    <section className="lf-setup-summary" aria-label="Current setup summary">
      <span className="lf-setup-eyebrow">Your machine</span>
      <strong className="lf-setup-summary-name">{state.draft.name || 'Unnamed machine'}</strong>
      <span className="lf-setup-chip">{mode}</span>
      <SetupBedPreview state={state} />
      <dl>
        <dt>Work area</dt>
        <dd>
          {state.draft.bedWidth} × {state.draft.bedHeight} mm
        </dd>
        <dt>Origin</dt>
        <dd>{state.draft.origin.replaceAll('-', ' ')}</dd>
        <dt>Controller</dt>
        <dd>{guide.label}</dd>
      </dl>
      <span className="lf-setup-connection">
        <span data-connected={connection === 'connected'} />
        {status}
      </span>
    </section>
  );
}

function SetupBedPreview({ state }: { readonly state: DeviceSetupState }): JSX.Element {
  const origin = state.draft.origin;
  const cx = origin === 'center' ? 100 : origin.endsWith('right') ? 171 : 29;
  const cy = origin === 'center' ? 60 : origin.startsWith('rear') ? 20 : 100;
  return (
    <svg
      className="lf-setup-bed-preview"
      viewBox="0 0 200 126"
      role="img"
      aria-label={`Work area diagram. Origin ${origin.replaceAll('-', ' ')}. Not to scale.`}
    >
      <rect x="29" y="20" width="142" height="80" rx="3" className="lf-setup-bed" />
      <path
        d="M57 20v80m29-80v80m28-80v80m29-80v80M29 40h142M29 60h142M29 80h142"
        className="lf-setup-bed-grid"
      />
      <circle cx={cx} cy={cy} r="6" className="lf-setup-bed-origin" />
      <path d={`M${cx - 10} ${cy}h20M${cx} ${cy - 10}v20`} className="lf-setup-bed-crosshair" />
      <text x="100" y="119" textAnchor="middle">
        FRONT
      </text>
    </svg>
  );
}
