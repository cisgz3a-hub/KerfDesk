// CNC operation numbers and the sections each cut type needs (ADR-431). Native
// disclosures keep their controls mounted; each summary names its current state
// and its tooltip says what it holds.

import { isVCarveToolCompatible } from '../../core/cnc/vcarve-tool-compatibility';
import { layerCncTool, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { RailSection } from '../kit';
import { CncFinishAllowanceField } from './CncFinishAllowanceField';
import { ReliefLayerRows } from './CncLayerToolFields';
import { CncFeedPresetRows } from './CncFeedPresetRows';
import { FeedsCalculatorRow } from './FeedsCalculatorRow';
import { NumberField } from './CncLayerPrimitives';
import { PocketFillRow } from './PocketFillRow';
import { AdaptivePocketFields } from './AdaptivePocketFields';
import { CncInlayFields } from './CncInlayFields';
import { CncEntryFields } from './CncEntryFields';
import { openMachineSetup } from '../laser/device-setup';
import { CncStageRecipeFields } from './CncStageRecipeFields';

export function CncLayerAdvancedGroup(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  return (
    <div className="lf-cnc-settings-fields" role="group" aria-label="Cut refinements">
      <ClearingFields {...props} />
      <CncInlayFields layer={props.layer} settings={props.settings} onCommit={props.onCommit} />
      <CutTypeSections {...props} />
      <CncStageRecipeFields {...props} />
      <FeedHelperRows
        layer={props.layer}
        settings={props.settings}
        onCommit={props.onCommit}
        onCommitSettings={props.onCommitSettings}
      />
    </div>
  );
}

function ClearingFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  const { settings, hasReliefObjects } = props;
  const vCarveClearing =
    settings.cutType === 'v-carve' &&
    (settings.vCarveFlatDepthEnabled ?? true) &&
    settings.vClearToolId !== undefined;
  if (
    settings.cutType !== 'pocket' &&
    settings.cutType !== 'inlay-pair' &&
    !vCarveClearing &&
    !hasReliefObjects
  ) {
    return null;
  }
  return (
    <RailSection
      label="Clearing strategy"
      badge={clearingBadge(settings, hasReliefObjects)}
      hint="Choose the spacing and pattern used to remove material inside an area."
    >
      <PocketFillRow layer={props.layer} settings={settings} onCommit={props.onCommit} />
      <StepoverField {...props} />
      <AdaptivePocketFields layer={props.layer} settings={settings} onCommit={props.onCommit} />
    </RailSection>
  );
}

function clearingBadge(settings: CncLayerSettings, hasReliefObjects: boolean): string {
  if (settings.cutType === 'pocket' && !hasReliefObjects) {
    const strategy = settings.pocketStrategy ?? 'offset';
    if (strategy === 'adaptive') return 'Adaptive';
    const pattern = strategy === 'offset' ? 'Offset' : 'Raster';
    return `${pattern} · ${settings.stepoverPercent} %`;
  }
  return `${settings.stepoverPercent} % stepover`;
}

export function DepthPerPassField(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  return (
    <NumberField
      stacked
      layer={props.layer}
      label="Depth per pass"
      unit="mm"
      value={props.settings.depthPerPassMm}
      min={0.05}
      max={50}
      step={0.25}
      title="Material removed per Z pass. Rule of thumb: up to half the bit diameter in wood."
      onCommit={(depthPerPassMm) => props.onCommit({ depthPerPassMm })}
    />
  );
}

// Feed, plunge and spindle speed share one row. The machine maximum sits under
// the spindle speed and opens Machine Setup, which owns it (ADR-306, ADR-431).
export function CncFeedFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly maxFeed: number;
  readonly spindleMaxRpm: number;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const { layer, settings, maxFeed, spindleMaxRpm, onCommit } = props;
  const maximum = spindleMaxRpm.toLocaleString('en-US');
  return (
    <div className="lf-cnc-feed-grid" role="group" aria-label="Feed, plunge and spindle speed">
      <NumberField
        stacked
        layer={layer}
        label="Feed"
        unit="mm/min"
        value={settings.feedMmPerMin}
        min={1}
        max={maxFeed}
        step={50}
        title="Cutting feed: how fast the bit moves sideways through the material."
        onCommit={(feedMmPerMin) => onCommit({ feedMmPerMin })}
      />
      <NumberField
        stacked
        layer={layer}
        label="Plunge"
        unit="mm/min"
        value={settings.plungeMmPerMin}
        min={1}
        max={maxFeed}
        step={25}
        title="Plunge feed: how fast the bit moves down into the material. Slower than Feed, because bits cut poorly straight down."
        onCommit={(plungeMmPerMin) => onCommit({ plungeMmPerMin })}
      />
      <NumberField
        stacked
        layer={layer}
        label="Spindle"
        ariaName="Spindle speed"
        unit="RPM"
        value={settings.spindleRpm}
        min={1000}
        max={spindleMaxRpm}
        step={500}
        title={`Spindle speed this operation asks for. The machine maximum (${maximum} RPM) is set in Machine Setup.`}
        onCommit={(spindleRpm) => onCommit({ spindleRpm })}
      />
      <button
        type="button"
        className="lf-cnc-link-button lf-cnc-feed-grid__maximum"
        aria-label={`Machine maximum: ${maximum} RPM. Edit in Machine Setup.`}
        title="The machine's top spindle speed, from Machine Setup. Select to change it there."
        onClick={() => openMachineSetup({ kind: 'cnc', field: 'spindle-max' })}
      >
        Max {maximum}
      </button>
    </div>
  );
}

function FeedHelperRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const presetCount = useStore((s) => s.cncLibrary.feedPresets.length);
  return (
    <>
      <RailSection
        label="Saved feeds"
        badge={presetCount === 0 ? 'None yet' : `${presetCount} saved`}
        hint="Reuse a tested set of feed, plunge, spindle speed, depth per pass and stepover, or save these values for next time."
      >
        <CncFeedPresetRows
          layer={props.layer}
          settings={props.settings}
          onCommit={props.onCommit}
        />
      </RailSection>
      <FeedsCalculatorRow
        layer={props.layer}
        settings={props.settings}
        onCommitSettings={props.onCommitSettings}
      />
    </>
  );
}

// Clearing spacing is editable on every operation that consumes it.
export function StepoverField(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  const vCarveClearing =
    props.settings.cutType === 'v-carve' &&
    (props.settings.vCarveFlatDepthEnabled ?? true) &&
    props.settings.vClearToolId !== undefined;
  if (
    props.settings.cutType !== 'pocket' &&
    props.settings.cutType !== 'inlay-pair' &&
    !vCarveClearing &&
    !props.hasReliefObjects
  ) {
    return null;
  }
  if (
    props.settings.cutType === 'pocket' &&
    props.settings.pocketStrategy === 'adaptive' &&
    !props.hasReliefObjects
  ) {
    return null;
  }
  return (
    <NumberField
      layer={props.layer}
      label="Stepover"
      unit="%"
      value={props.settings.stepoverPercent}
      positiveOnly
      step={5}
      title={stepoverDescription(props.hasReliefObjects, vCarveClearing)}
      onCommit={(stepoverPercent) => props.onCommit({ stepoverPercent })}
    />
  );
}

function stepoverDescription(hasReliefObjects: boolean, vCarveClearing: boolean): string {
  if (hasReliefObjects) {
    return 'Relief roughing and pocket ring spacing as a percentage of the bit diameter.';
  }
  return vCarveClearing
    ? 'Flat-floor clearing spacing as a percentage of the clearing bit diameter. Detail controls the V-bit finishing pitch separately.'
    : 'Pocket clearing spacing as a percentage of the bit diameter. For a bit that narrows toward its tip (ball nose, V-bit, engraving bit or tapered ball nose) it is a percentage of the width the bit cuts in one depth pass.';
}

// Only show refinements that apply to the current cut type or artwork.
export function CutTypeSections(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const { layer, settings, onCommit } = props;
  const offsetProfile =
    settings.cutType === 'profile-outside' || settings.cutType === 'profile-inside';
  return (
    <>
      {offsetProfile ? (
        <RailSection
          label="Wall finish"
          badge={(settings.finishAllowanceMm ?? 0) > 0 ? 'Finish pass' : 'No allowance'}
          hint="Leave a small allowance during roughing, then remove it in a true-wall finish. It uses one full-depth pass unless separate wall finishing values specify smaller depth passes. Zero uses no separate finish pass."
        >
          <CncFinishAllowanceField layer={layer} settings={settings} onCommit={onCommit} />
        </RailSection>
      ) : null}
      {props.hasReliefObjects ? (
        <RailSection
          label="Relief finish"
          hint="Review relief depth ownership and control the spacing of the finishing passes."
        >
          <ReliefLayerRows
            layer={layer}
            settings={settings}
            onCommit={onCommit}
            onCommitSettings={props.onCommitSettings}
          />
        </RailSection>
      ) : null}
      {settings.cutType === 'v-carve' ? (
        <RailSection
          label="V-carve detail"
          badge={settings.vResolutionMm > 0 ? `${settings.vResolutionMm} mm` : 'Automatic'}
          hint="Boundary sampling detail. Zero uses automatic detail; smaller values can add detail and take longer to prepare."
        >
          <VCarveDetailField layer={layer} settings={settings} onCommit={onCommit} />
        </RailSection>
      ) : null}
      <CncEntryFields {...props} />
    </>
  );
}

function VCarveDetailField(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  return (
    <NumberField
      layer={props.layer}
      label="Detail"
      unit="mm"
      value={props.settings.vResolutionMm}
      min={0}
      max={5}
      step={0.05}
      title="V-carve boundary sampling and flat-core clearing pitch. 0 = automatic. Smaller values refine sampling and can increase compile/job time; this is not an exact whole-artwork tolerance. Pointed cutters can leave scallops between floor passes."
      onCommit={(vResolutionMm) => props.onCommit({ vResolutionMm })}
    />
  );
}

// H.3: a live warning when THIS operation's bit lacks a supported conical
// envelope. It stays beside the bit choice rather than inside a section.
// Wrong-kind selection remains advisory-only and keeps its legacy fallback
// geometry; an actual V-bit with an invalid angle is the separate exact
// compile-integrity refusal. Read the layer tool so overrides are represented.
export function VCarveToolWarning(props: {
  readonly settings: CncLayerSettings;
}): JSX.Element | null {
  const activeToolIsCompatible = useStore(
    (s) =>
      s.project.machine?.kind === 'cnc' &&
      isVCarveToolCompatible(layerCncTool(s.project.machine, props.settings)),
  );
  if (props.settings.cutType !== 'v-carve' || activeToolIsCompatible) return null;
  return (
    <div style={vbitWarningStyle} role="alert">
      V-carve needs a V-bit or modeled angled engraving bit. Choose one under Bit above. Unsupported
      selections may use legacy 60° fallback geometry where compatible.
    </div>
  );
}

const vbitWarningStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-danger-fg)',
  padding: '2px 0 2px 4px',
};
