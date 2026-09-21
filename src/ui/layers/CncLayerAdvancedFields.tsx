// CNC operation essentials and purpose-labelled refinements. Native
// disclosures keep the existing controls mounted while reducing visual noise.

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
import { SetupOwnedValueRow } from './SetupOwnedValueRow';

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
      hint="Choose the spacing and pattern used to remove material inside an area."
    >
      <p className="lf-cnc-settings-hint">
        Stepover is the spacing between neighbouring passes, as a percentage of the bit diameter.
      </p>
      <PocketFillRow layer={props.layer} settings={settings} onCommit={props.onCommit} />
      <StepoverField {...props} />
      <AdaptivePocketFields layer={props.layer} settings={settings} onCommit={props.onCommit} />
    </RailSection>
  );
}

// The core per-cut parameters always remain visible.
export function CncCoreCutFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly maxFeed: number;
  readonly spindleMaxRpm: number;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const { layer, settings, maxFeed, spindleMaxRpm, onCommit } = props;
  return (
    <section className="lf-cnc-settings-card" aria-label="Feeds & passes">
      <h4>Feeds &amp; passes</h4>
      <p className="lf-cnc-settings-hint">
        Feed moves across the material. Plunge moves down into it.
      </p>
      <NumberField
        layer={layer}
        label="Depth per pass"
        unit="mm"
        value={settings.depthPerPassMm}
        min={0.05}
        max={50}
        step={0.25}
        title="Material removed per Z pass. Rule of thumb: up to half the bit diameter in wood."
        onCommit={(depthPerPassMm) => onCommit({ depthPerPassMm })}
      />
      <NumberField
        layer={layer}
        label="Feed"
        unit="mm/min"
        value={settings.feedMmPerMin}
        min={1}
        max={maxFeed}
        step={50}
        title="XY cutting feed rate."
        onCommit={(feedMmPerMin) => onCommit({ feedMmPerMin })}
      />
      <NumberField
        layer={layer}
        label="Plunge"
        unit="mm/min"
        value={settings.plungeMmPerMin}
        min={1}
        max={maxFeed}
        step={25}
        title="Z plunge feed rate — slower than XY feed, bits cut poorly straight down."
        onCommit={(plungeMmPerMin) => onCommit({ plungeMmPerMin })}
      />
      <SetupOwnedValueRow
        label="Machine maximum"
        value={`${spindleMaxRpm.toLocaleString('en-US')} RPM`}
        description="This is the machine maximum spindle speed saved in Startup Setup. Artwork spindle speed below is the requested running speed for this operation."
        setupField="spindle-max"
      />
      <NumberField
        layer={layer}
        label="Artwork spindle speed"
        unit="RPM"
        value={settings.spindleRpm}
        min={1000}
        max={spindleMaxRpm}
        step={500}
        title="Requested spindle running speed for this artwork operation. Machine maximum is shown above and is edited in Startup Setup."
        onCommit={(spindleRpm) => onCommit({ spindleRpm })}
      />
    </section>
  );
}

function FeedHelperRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  return (
    <>
      <RailSection
        label="Saved feeds"
        hint="Save or reuse feed, plunge, spindle, depth per pass and stepover settings."
      >
        <p className="lf-cnc-settings-hint">
          Reuse a tested set of feeds and speeds, or save these values for next time.
        </p>
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
    : 'Pocket clearing spacing as a percentage of the bit diameter.';
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
          hint="Leave material during roughing, then remove it in a final pass along the wall."
        >
          <p className="lf-cnc-settings-hint">
            Leave a small allowance for a final full-depth wall pass. Zero uses no separate finish
            pass.
          </p>
          <CncFinishAllowanceField layer={layer} settings={settings} onCommit={onCommit} />
        </RailSection>
      ) : null}
      {props.hasReliefObjects ? (
        <RailSection
          label="Relief finish"
          hint="Review relief depth ownership and control the spacing of the finishing passes."
        >
          <ReliefLayerRows layer={layer} settings={settings} onCommit={onCommit} />
        </RailSection>
      ) : null}
      {settings.cutType === 'v-carve' ? (
        <RailSection
          label="V-carve detail"
          hint="Set boundary sampling detail and review whether the assigned cutter suits V-carving."
          open
        >
          <p className="lf-cnc-settings-hint">
            Zero uses automatic detail. Smaller values can add detail and increase preparation time.
          </p>
          <VCarveFields layer={layer} settings={settings} onCommit={onCommit} />
        </RailSection>
      ) : null}
      <CncEntryFields {...props} />
    </>
  );
}

// H.3 V-carve options: medial sampling detail + a live warning when THIS LAYER's bit lacks a
// supported conical envelope. Wrong-kind selection remains advisory-only and keeps its legacy
// fallback geometry; an actual V-bit with invalid angle is the separate exact compile-integrity
// refusal. Read the layer tool so overrides are represented.
function VCarveFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const activeToolIsCompatible = useStore(
    (s) =>
      s.project.machine?.kind === 'cnc' &&
      isVCarveToolCompatible(layerCncTool(s.project.machine, props.settings)),
  );
  return (
    <>
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
      {!activeToolIsCompatible ? (
        <div style={vbitWarningStyle} role="alert">
          V-carve needs a V-bit or modeled angled engraving bit. Choose one in Tool &amp; material
          above. Unsupported selections may use legacy 60° fallback geometry where compatible.
        </div>
      ) : null}
    </>
  );
}

const vbitWarningStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-danger-fg)',
  padding: '2px 0 2px 4px',
};
