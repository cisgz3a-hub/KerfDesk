// CncLayerFields — per-layer CNC operation editor (Easel's per-object cut
// panel, applied per color layer). Rendered by LayerRow instead of the laser
// fields when the project machine is CNC. Writes flow through the existing
// setLayerParam action as a whole `cnc` patch, so undo/dirty tracking and
// .lf2 persistence come for free.
//
// Operation material and cutter choices stay beside their cutting settings.
// Cut depth and feeds lead the editor; named disclosures organise the remaining
// controls without unmounting inputs or discarding their in-progress edits.
// Shared row/input controls live in CncLayerPrimitives; the advanced group in
// CncLayerAdvancedFields.

import { useState } from 'react';
import {
  CNC_CUT_TYPES,
  DEFAULT_CNC_LAYER_SETTINGS,
  cutTypeLabel,
  type CncCutType,
  type CncLayerSettings,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { withManualCncFeedPatch } from '../state/cnc-feed-provenance';
import { CncCoreCutFields, CncLayerAdvancedGroup } from './CncLayerAdvancedFields';
import { CncTabFields } from './CncTabFields';
import { CncLineArtContoursField } from './CncLineArtContoursField';
import { CncOpenPathNote } from './CncOpenPathNote';
import { useLayerHasReliefObjects } from './CncLayerToolFields';
import { NumberField, Row, selectStyle } from './CncLayerPrimitives';
import { CncSetupReferenceFields } from './CncSetupReferenceFields';
import { CncOperationToolFields } from './CncOperationToolFields';
import './cnc-operation-settings.css';

export function CncLayerFields(props: {
  readonly layer: Layer;
  readonly onSettingsChange?: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const { layer } = props;
  // A new material or primary tool replaces feed drafts even when its recipe
  // produces the same canonical numbers. Secondary tool choices leave them alone.
  const [assignmentRevision, setAssignmentRevision] = useState(0);
  const setLayerParam = useStore((s) => s.setLayerParam);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const machine = useStore((s) => s.project.machine);
  const hasReliefObjects = useLayerHasReliefObjects(layer);
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const isCnc = machine?.kind === 'cnc';
  const spindleMaxRpm = isCnc ? machine.params.spindleMaxRpm : 24000;
  const stockThicknessMm = isCnc ? machine.stock.thicknessMm : 0;
  const isProfile = settings.cutType.startsWith('profile') || settings.cutType === 'inlay-pair';
  const commitSettings = (next: CncLayerSettings): void => {
    if (props.onSettingsChange !== undefined) props.onSettingsChange(next);
    else setLayerParam(layer.id, { cnc: next });
  };
  const commit = (patch: Partial<CncLayerSettings>): void =>
    commitSettings(withManualCncFeedPatch(settings, patch));

  return (
    <div className="lf-cnc-settings">
      <CncOperationToolFields
        layer={layer}
        settings={settings}
        hasReliefObjects={hasReliefObjects}
        onCommitSettings={(next, replaceFeedDrafts) => {
          if (replaceFeedDrafts) setAssignmentRevision((revision) => revision + 1);
          commitSettings(next);
        }}
      />
      <CncCutDepthSection
        layer={layer}
        settings={settings}
        stockThicknessMm={stockThicknessMm}
        hasReliefObjects={hasReliefObjects}
        onCommit={commit}
      />
      <CncCoreCutFields
        key={JSON.stringify([
          settings.materialKey ?? null,
          settings.toolId ?? null,
          assignmentRevision,
        ])}
        layer={layer}
        settings={settings}
        maxFeed={maxFeed}
        spindleMaxRpm={spindleMaxRpm}
        onCommit={commit}
      />
      {isProfile ? <CncTabFields layer={layer} settings={settings} onCommit={commit} /> : null}
      <CncLayerAdvancedGroup
        layer={layer}
        settings={settings}
        hasReliefObjects={hasReliefObjects}
        onCommit={commit}
        onCommitSettings={commitSettings}
      />
      <CncSetupReferenceFields />
    </div>
  );
}

function CncCutDepthSection(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly stockThicknessMm: number;
  readonly hasReliefObjects: boolean;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const { layer, settings, stockThicknessMm, hasReliefObjects, onCommit: commit } = props;
  return (
    <section className="lf-cnc-settings-card" aria-label="Cut & depth">
      <div className="lf-cnc-settings-heading">
        <h4>Cut &amp; depth</h4>
      </div>
      <Row label="Cut type">
        <select
          value={settings.cutType}
          onChange={(e) => commit(cutTypePatch(settings, e.target.value as CncCutType))}
          aria-label={`Cut type for ${layer.color}`}
          title="How this layer's shapes are machined: outline (with bit-radius offset), pocket, or engrave."
          style={selectStyle}
        >
          {CNC_CUT_TYPES.map((cutType) => (
            <option key={cutType} value={cutType}>
              {cutTypeLabel(cutType)}
            </option>
          ))}
        </select>
      </Row>
      <p className="lf-cnc-settings-hint">{cutTypeHint(settings.cutType)}</p>
      <CncLineArtContoursField layer={layer} settings={settings} onCommit={commit} />
      <CncOpenPathNote layer={layer} settings={settings} />
      {/*
        CncThinDetailNote is deliberately not rendered here. It ran the whole
        V-carve ladder on the main thread from a React effect keyed on the
        layer's settings, so selecting the V-carve cut type blocked the UI for
        as long as a compile takes — measured at 13.7 s for 120 thin contours at
        3 mm depth. Nothing is lost by leaving it out: the ladder already
        reports thinResidual and passLimited to Job Review, which is the warning
        surface the operator confirms (rule 7). Restore it once the check runs
        on the preparation worker instead of the render thread. CncOpenPathNote
        above stays: it only flattens contours, it never builds the ladder.
      */}
      {hasReliefObjects ? (
        <p className="lf-cnc-settings-hint" role="note">
          Relief depth comes from the selected relief artwork. Cut depth here applies to vector
          shapes only.
        </p>
      ) : null}
      <CutDepthField
        layer={layer}
        settings={settings}
        stockThicknessMm={stockThicknessMm}
        onCommit={commit}
      />
    </section>
  );
}

function cutTypePatch(settings: CncLayerSettings, cutType: CncCutType): Partial<CncLayerSettings> {
  return {
    cutType,
    ...(cutType === 'v-carve' && settings.cutType !== 'v-carve'
      ? { vCarveFlatDepthEnabled: false }
      : {}),
  };
}

function cutTypeHint(cutType: CncCutType): string {
  switch (cutType) {
    case 'profile-outside':
      return 'Cut around the outside edge to keep the shape at its drawn size.';
    case 'profile-inside':
      return 'Cut inside an opening, allowing for the width of the bit.';
    case 'profile-on-path':
    case 'engrave':
      return 'Follow the drawn line with the centre of the bit.';
    case 'pocket':
      return 'Remove the material inside closed shapes to the chosen depth.';
    case 'v-carve':
      return 'Use an angled bit to carve depth that follows the artwork width.';
    case 'inlay-pair':
      return 'Create a matching pocket and mirrored insert from this artwork.';
    case 'drill':
      return 'Drill at shape centres, removing material in depth increments.';
    case 'relief-rough':
    case 'relief-finish':
      return 'Machine the relief using its artwork depth and the assigned cutter.';
  }
}

// Cut depth + a one-click stock-depth action. Calling exact stock thickness a
// "through cut" over-promises: real stock varies, while any spoilboard overcut
// must be a measured operator choice rather than a hidden extra depth.
function CutDepthField(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly stockThicknessMm: number;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const isVCarve = props.settings.cutType === 'v-carve';
  const flatDepthEnabled = props.settings.vCarveFlatDepthEnabled ?? true;
  if (isVCarve) {
    return (
      <>
        <Row label="Flat depth">
          <input
            type="checkbox"
            checked={flatDepthEnabled}
            onChange={(event) => props.onCommit({ vCarveFlatDepthEnabled: event.target.checked })}
            aria-label={`Flat depth for ${props.layer.color}`}
            title="Limit the V-carve to a flat floor. Wide areas then require additional clearing paths. Leave off for an ordinary flowing-depth V-carve."
          />
        </Row>
        {flatDepthEnabled ? (
          <NumberField
            layer={props.layer}
            label="Floor depth"
            unit="mm"
            value={props.settings.depthMm}
            min={0.05}
            max={200}
            step={0.5}
            title="Maximum V-carve depth. Areas wider than the V-bit reaches at this depth are cleared as a flat core."
            onCommit={(depthMm) => props.onCommit({ depthMm })}
          />
        ) : (
          <p role="note" style={plainVCarveNoteStyle}>
            Depth follows stroke width and the selected V-bit angle. Extra clearing lines appear
            only where the artwork is wider than the bit can physically cut.
          </p>
        )}
      </>
    );
  }
  return (
    <>
      <NumberField
        layer={props.layer}
        label={props.settings.cutType === 'inlay-pair' ? 'Insert depth' : 'Cut depth'}
        unit="mm"
        value={props.settings.depthMm}
        min={0.05}
        max={200}
        step={0.5}
        title={
          props.settings.cutType === 'inlay-pair'
            ? 'Male insert profile depth. Equal to stock thickness to free the insert.'
            : 'Total depth below the stock top. Equal to stock thickness for a through cut.'
        }
        onCommit={(depthMm) => props.onCommit({ depthMm })}
      />
      {props.stockThicknessMm > 0 ? (
        <Row label="">
          <button
            type="button"
            onClick={() => props.onCommit({ depthMm: props.stockThicknessMm })}
            title="Set exactly to the measured stock thickness. Add a verified overcut manually only when the setup needs it."
            style={throughButtonStyle}
          >
            Set to stock thickness ({props.stockThicknessMm} mm)
          </button>
        </Row>
      ) : null}
    </>
  );
}

const throughButtonStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 11,
  padding: '4px 8px',
};

const plainVCarveNoteStyle: React.CSSProperties = {
  fontSize: 11,
  margin: '2px 0 6px 0',
  color: 'var(--lf-text-dim)',
};
