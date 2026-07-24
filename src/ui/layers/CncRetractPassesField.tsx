// CncRetractPassesField — when on (default), a profile or engrave "line" cut
// lifts to safe Z and replunges before every pass instead of stepping the bit
// straight down in place, matching how a pocket re-enters each region (ADR-253).
// Shown for the outline cut types + engrave; pocket, v-carve, drill, and relief
// manage their own between-pass motion and ignore the setting.

import type { CncLayerSettings, Layer } from '../../core/scene';
import { Row } from './CncLayerPrimitives';

export function CncRetractPassesField(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  const { cutType } = props.settings;
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
