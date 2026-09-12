import { layerCncTool, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { NumberField, Row, selectStyle } from './CncLayerPrimitives';

type ProfileLead = NonNullable<CncLayerSettings['profileLead']>;
type Props = {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
};

export function CncProfileLeadFields(props: Props): JSX.Element | null {
  const machine = useStore((state) => state.project.machine);
  const { cutType, profileLead: lead } = props.settings;
  if (cutType !== 'profile-outside' && cutType !== 'profile-inside') return null;
  const toolRadius =
    machine?.kind === 'cnc' ? layerCncTool(machine, props.settings).diameterMm / 2 : 0;
  const shape = lead?.shape ?? 'arc';
  return (
    <>
      <Row label="Profile leads">
        <select
          value={shape}
          onChange={(event) =>
            props.onCommit({
              profileLead: { ...lead, shape: event.target.value as ProfileLead['shape'] },
            })
          }
          aria-label={`Profile leads for ${props.layer.color}`}
          title="Lead into and out of closed offset profiles from the waste side. Arc is the default; None explicitly turns leads off."
          style={selectStyle}
        >
          <option value="arc">Arc</option>
          <option value="line">Line</option>
          <option value="none">None</option>
        </select>
      </Row>
      {shape !== 'none' ? (
        <ProfileLeadDimensions {...props} lead={{ ...lead, shape }} toolRadius={toolRadius} />
      ) : null}
      {(props.settings.rampEntryDeg ?? 0) > 0 && shape !== 'none' ? (
        <p role="note" style={noteStyle}>
          Ramp entry controls this operation&apos;s entry. Profile lead settings are retained for
          when ramp entry is off.
        </p>
      ) : null}
    </>
  );
}

function ProfileLeadDimensions(
  props: Props & { readonly lead: ProfileLead; readonly toolRadius: number },
): JSX.Element {
  const { lead } = props;
  return (
    <>
      <NumberField
        layer={props.layer}
        label={lead.shape === 'line' ? 'Lead length' : 'Lead radius'}
        unit="mm"
        value={lead.radiusMm ?? props.toolRadius}
        positiveOnly
        step={0.1}
        title="Arc radius or line length. Uses the resolved cutter radius until you enter a custom value. A lead that does not fit falls back to the normal entry."
        onCommit={(radiusMm) => props.onCommit({ profileLead: { ...lead, radiusMm } })}
      />
      {lead.radiusMm !== undefined ? (
        <Row label="">
          <button
            type="button"
            title="Remove the custom lead radius or length and follow the resolved cutter radius."
            onClick={() => {
              const { radiusMm: _radius, ...profileLead } = lead;
              props.onCommit({ profileLead });
            }}
          >
            Use cutter radius ({props.toolRadius} mm)
          </button>
        </Row>
      ) : null}
      {lead.shape === 'arc' ? (
        <NumberField
          layer={props.layer}
          label="Lead sweep"
          unit="°"
          value={lead.sweepDeg ?? 90}
          min={10}
          max={180}
          step={5}
          title="Arc lead sweep from 10° to 180°. The default is 90°."
          onCommit={(sweepDeg) => props.onCommit({ profileLead: { ...lead, sweepDeg } })}
        />
      ) : null}
    </>
  );
}

const noteStyle: React.CSSProperties = {
  margin: '2px 0 6px',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
