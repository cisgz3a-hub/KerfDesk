// CncRetractPassesField — when on (default), a profile or engrave "line" cut
// lifts to safe Z and replunges before every pass instead of stepping the bit
// straight down in place (ADR-253). Shown for the outline cut types + engrave.
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
  return (
    <Row label="Retract between passes">
      <input
        type="checkbox"
        checked={props.settings.retractBetweenPasses ?? true}
        onChange={(e) => props.onCommit({ retractBetweenPasses: e.target.checked })}
        aria-label={`Retract between passes for ${props.layer.color}`}
        title="Lift to safe Z and replunge before each pass, instead of stepping the bit straight down in place. Clears chips and gives a clean re-entry — the same motion a pocket uses."
      />
    </Row>
  );
}

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
