import type { CncLayerSettings, Layer } from '../../core/scene';
import { RailSection } from '../kit';
import { HelicalEntryRows, MotionPolishRows } from './CncLayerToolFields';
import { CncProfileLeadFields } from './CncProfileLeadFields';
import { CncRetractPassesField } from './CncRetractPassesField';
import { cutTypeShowsCutDirection } from './CncReliefStrategyRows';

export function CncEntryFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element | null {
  const { layer, settings, onCommit } = props;
  const applies =
    settings.cutType.startsWith('profile') ||
    settings.cutType === 'pocket' ||
    settings.cutType === 'engrave' ||
    settings.cutType === 'v-carve';
  if (!applies) return null;
  return (
    <RailSection
      label="Entry & travel"
      badge={entryBadge(settings)}
      hint="Choose cut direction, how the bit enters the material and movement between passes."
    >
      <MotionPolishRows {...props} />
      <CncProfileLeadFields layer={layer} settings={settings} onCommit={onCommit} />
      {settings.cutType === 'pocket' && settings.pocketStrategy !== 'adaptive' ? (
        <HelicalEntryRows {...props} />
      ) : null}
      <CncRetractPassesField layer={layer} settings={settings} onCommit={onCommit} />
    </RailSection>
  );
}

// The closed summary names direction and entry, the two choices that change the cut.
function entryBadge(settings: CncLayerSettings): string {
  const ramp =
    (settings.cutType === 'v-carve' ? settings.vCarveRampEntryDeg : settings.rampEntryDeg) ?? 0;
  const circularRamp =
    settings.cutType === 'pocket' &&
    settings.pocketStrategy !== 'adaptive' &&
    settings.helixEntry !== undefined;
  const entry =
    settings.cutType === 'pocket' && settings.pocketStrategy === 'adaptive'
      ? 'Adaptive entry'
      : circularRamp
        ? 'Circular ramp'
        : ramp > 0
          ? `Ramp ${ramp}°`
          : 'Plunge';
  if (!cutTypeShowsCutDirection(settings.cutType)) return entry;
  const direction =
    settings.cutDirection === 'climb'
      ? 'Climb'
      : settings.cutDirection === 'conventional'
        ? 'Conventional'
        : 'Default direction';
  return `${direction} · ${entry}`;
}
