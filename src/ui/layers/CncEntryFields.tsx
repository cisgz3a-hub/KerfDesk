import type { CncLayerSettings, Layer } from '../../core/scene';
import { RailSection } from '../kit';
import { HelicalEntryRows, MotionPolishRows } from './CncLayerToolFields';
import { CncProfileLeadFields } from './CncProfileLeadFields';
import { CncRetractPassesField } from './CncRetractPassesField';
import { cutTypeShowsCutDirection } from './CncReliefStrategyRows';

export function CncEntryFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
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
      badge={entryBadge(settings, props.hasReliefObjects)}
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
function entryBadge(settings: CncLayerSettings, hasReliefObjects: boolean): string {
  const entry = entrySummary(settings, hasReliefObjects);
  if (!cutTypeShowsCutDirection(settings.cutType)) return entry;
  const direction =
    settings.cutDirection === 'climb'
      ? 'Climb'
      : settings.cutDirection === 'conventional'
        ? 'Conventional'
        : 'Default direction';
  return `${direction} · ${entry}`;
}

// Adaptive clearing enters each depth on its planner's own helix and skips
// the ramp angle, which still ramps the roughing of any relief on the layer
// (ADR-424). An adaptive pocket names its helix, and the angle only as the
// reliefs' entry (ADR-481 Amendment 1).
function entrySummary(settings: CncLayerSettings, hasReliefObjects: boolean): string {
  // V-carve enters along its variable-depth profile (ADR-285 §6).
  if (settings.cutType === 'v-carve') return 'Profile entry';
  const ramp = settings.rampEntryDeg ?? 0;
  if (settings.cutType === 'pocket' && settings.pocketStrategy === 'adaptive') {
    if (!hasReliefObjects) return 'Adaptive helix';
    return ramp > 0 ? `Adaptive helix · Relief ramp ${ramp}°` : 'Adaptive helix · Relief plunge';
  }
  const circularRamp = settings.cutType === 'pocket' && settings.helixEntry !== undefined;
  return circularRamp ? 'Circular ramp' : ramp > 0 ? `Ramp ${ramp}°` : 'Plunge';
}
