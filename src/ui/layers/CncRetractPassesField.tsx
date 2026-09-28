// CncRetractPassesField — when on (default), a profile or engrave "line" cut
// lifts to safe Z and replunges before every pass instead of stepping the bit
// straight down in place (ADR-253). Shown for the outline cut types + engrave.
// A profile with leads starts every pass at its lead, off the end of the last
// one, so it lifts either way; the row says so (CNC gap audit CW-02).
// Offset and raster pockets get "Lift between rings" instead: off (default),
// they step to the next ring or row at the plunge feed and stay in the cut;
// on, they lift and re-plunge between them as before (ADR-491). V-carve,
// drill, relief and adaptive pockets manage their own between-pass motion.

import type { CncLayerSettings, Layer } from '../../core/scene';
import { Row } from './CncLayerPrimitives';

export function CncRetractPassesField(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  const { cutType } = props.settings;
  if (cutType === 'pocket') return <PocketLiftRow {...props} />;
  const applies =
    cutType === 'profile-outside' ||
    cutType === 'profile-inside' ||
    cutType === 'profile-on-path' ||
    cutType === 'engrave';
  if (!applies) return null;
  const leadsLift =
    (cutType === 'profile-outside' || cutType === 'profile-inside') &&
    props.settings.profileLead?.shape !== 'none';
  return (
    <>
      <Row label="Retract between passes">
        <input
          type="checkbox"
          checked={props.settings.retractBetweenPasses ?? true}
          onChange={(e) => props.onCommit({ retractBetweenPasses: e.target.checked })}
          aria-label={`Retract between passes for ${props.layer.color}`}
          title="Lift to safe Z before each pass, instead of stepping the bit straight down in place. Clears chips and gives a clean re-entry. The bit rapids back down to 1 mm above the last cut and feeds in from there."
        />
      </Row>
      {leadsLift ? (
        <p role="note" style={noteStyle}>
          With profile leads, every pass starts at its lead, away from where the last one ended, so
          the bit lifts between passes either way. Set Profile leads to None to step straight down.
        </p>
      ) : null}
    </>
  );
}

const noteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-faint)',
  margin: '2px 0 6px 0',
};

function PocketLiftRow(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  if (props.settings.pocketStrategy === 'adaptive') return null;
  return (
    <Row label="Lift between rings">
      <input
        type="checkbox"
        checked={props.settings.pocketLiftBetweenRings ?? false}
        onChange={(e) => props.onCommit({ pocketLiftBetweenRings: e.target.checked })}
        aria-label={`Lift between rings for ${props.layer.color}`}
        title="Lift to safe Z and plunge again between every ring or row. Off: the bit steps over to the next ring or row at the plunge feed and stays in the cut, which saves the lifts and plunges."
      />
    </Row>
  );
}
