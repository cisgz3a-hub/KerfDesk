// Operation-owned relief, entry, and motion-polish fields for CNC artwork.
// All cutter assignments live in Startup Setup's Tool Plan.

import { sceneObjectUsesOperation, type CncLayerSettings, type Layer } from '../../core/scene';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { useStore } from '../state';

// Relief roughing (H.5) reads depth-per-pass + stepover from the layer but
// takes total depth from the relief object — CncLayerFields keys its
// honest-card hints on this (handoff §7.C contract fix).
export function useLayerHasReliefObjects(layer: Layer): boolean {
  return useStore((s) =>
    s.project.scene.objects.some(
      (object) => object.kind === 'relief' && sceneObjectUsesOperation(object, layer),
    ),
  );
}

// The relief block for layers carrying relief objects: the honest-card
// hint (which fields drive roughing) plus the H.8 finishing controls.
export function ReliefLayerRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  return (
    <>
      <div style={reliefHintStyle}>
        Reliefs on this layer rough with Depth/pass + Stepover; total depth comes from the
        relief&apos;s own Depth (select the relief to edit it). Cut depth applies to the other
        shapes only.
      </div>
      <ReliefScallopRow layer={props.layer} settings={props.settings} onCommit={props.onCommit} />
    </>
  );
}

// Cutter assignment lives in Startup Setup; the operation still owns its
// finishing scallop target.
function ReliefScallopRow(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  return (
    <Row label="Finish scallop">
      <ClearableNumberField
        min={0.005}
        max={1}
        step={0.005}
        value={props.settings.reliefScallopMm ?? 0.025}
        onCommit={(mm) => props.onCommit({ reliefScallopMm: mm })}
        ariaLabel={`Relief scallop height for ${props.layer.color}`}
        title="Scallop height target (mm) for the relief finishing bit assigned in Startup Setup — smaller = finer finishing rows, longer job."
        style={scallopInputStyle}
      />
      <span style={rampUnitStyle}>mm</span>
    </Row>
  );
}

// H.9 motion polish rows — both opt-in: '' keeps the pre-H.9 behavior.
export function MotionPolishRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const isVCarve = props.settings.cutType === 'v-carve';
  const showCutDirection =
    props.settings.cutType === 'profile-outside' ||
    props.settings.cutType === 'profile-inside' ||
    props.settings.cutType === 'pocket';
  return (
    <Row label="Entry">
      {showCutDirection ? (
        <select
          value={props.settings.cutDirection ?? ''}
          onChange={(e) => {
            if (e.target.value === '') {
              const { cutDirection: _removed, ...rest } = props.settings;
              props.onCommitSettings(rest);
            } else {
              props.onCommit({
                cutDirection: e.target.value === 'climb' ? 'climb' : 'conventional',
              });
            }
          }}
          aria-label={`Cut direction for ${props.layer.color}`}
          title="Climb or conventional cutting for profile/pocket toolpaths (also moves entry points to mid-segment). Default keeps the compiler's natural direction."
          style={directionSelectStyle}
        >
          <option value="">Default direction</option>
          <option value="climb">Climb</option>
          <option value="conventional">Conventional</option>
        </select>
      ) : null}
      <ClearableNumberField
        min={0}
        max={isVCarve ? Number.MAX_VALUE : 45}
        step={0.5}
        value={(isVCarve ? props.settings.vCarveRampEntryDeg : props.settings.rampEntryDeg) ?? 0}
        onCommit={(deg) => commitRampEntry(props.settings, deg, props.onCommitSettings)}
        ariaLabel={`Ramp entry angle for ${props.layer.color}`}
        title={
          isVCarve
            ? "Requested maximum entry angle. The certified medial depth profile may supersede it; Job Review reports that explicitly. Use only the cutter manufacturer's approved angle. 0 = profile-controlled entry."
            : 'Descend into cuts along the path at this angle instead of plunging straight down. 0 = plunge (default).'
        }
        style={rampInputStyle}
      />
      <span style={rampUnitStyle}>{isVCarve ? '° requested' : '° ramp'}</span>
    </Row>
  );
}

function commitRampEntry(
  settings: CncLayerSettings,
  deg: number,
  commit: (settings: CncLayerSettings) => void,
): void {
  if (settings.cutType === 'v-carve') {
    const { vCarveRampEntryDeg: _removed, ...rest } = settings;
    commit(deg <= 0 ? rest : { ...rest, vCarveRampEntryDeg: deg });
    return;
  }
  const { rampEntryDeg: _removed, ...withoutRamp } = settings;
  if (deg <= 0) {
    commit(withoutRamp);
    return;
  }
  const { helixEntry: _helixRemoved, ...withoutHelix } = withoutRamp;
  commit({ ...withoutHelix, rampEntryDeg: deg });
}

export function HelicalEntryRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const helix = props.settings.helixEntry;
  return (
    <>
      <Row label="Helical entry">
        <input
          type="checkbox"
          checked={helix !== undefined}
          onChange={(event) => {
            if (!event.target.checked) {
              const { helixEntry: _removed, ...rest } = props.settings;
              props.onCommitSettings(rest);
              return;
            }
            const { rampEntryDeg: _removed, ...rest } = props.settings;
            props.onCommitSettings({
              ...rest,
              helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 },
            });
          }}
          aria-label={`Helical entry for ${props.layer.color}`}
          title="Descend into offset pockets with native G2/G3 circles instead of plunging. If a pocket roughing bit is assigned, edit Startup Setup > Tool Plan and choose Single bit because the two operations cannot currently compile together."
        />
        <span style={helixLabelStyle}>Use circular ramp</span>
      </Row>
      {helix !== undefined && props.settings.pocketRoughToolId !== undefined ? (
        <p role="note" style={helixConflictStyle}>
          Helical entry cannot compile while a pocket roughing bit is assigned. Edit Startup Setup
          &gt; Tool Plan and choose Single bit for this artwork.
        </p>
      ) : null}
      {helix === undefined ? null : (
        <>
          <HelixNumberRow
            label="Helix diameter"
            ariaLabel={`Maximum helix diameter for ${props.layer.color}`}
            value={helix.maxDiameterMm}
            min={helix.minDiameterMm}
            max={100}
            step={0.5}
            unit="mm max"
            onCommit={(maxDiameterMm) =>
              props.onCommit({ helixEntry: { ...helix, maxDiameterMm } })
            }
          />
          <HelixNumberRow
            label="Minimum fit"
            ariaLabel={`Minimum helix diameter for ${props.layer.color}`}
            value={helix.minDiameterMm}
            min={0.1}
            max={helix.maxDiameterMm}
            step={0.5}
            unit="mm"
            onCommit={(minDiameterMm) =>
              props.onCommit({ helixEntry: { ...helix, minDiameterMm } })
            }
          />
          <HelixNumberRow
            label="Helix angle"
            ariaLabel={`Helix angle for ${props.layer.color}`}
            value={helix.angleDeg}
            min={0.5}
            max={15}
            step={0.5}
            unit="deg"
            onCommit={(angleDeg) => props.onCommit({ helixEntry: { ...helix, angleDeg } })}
          />
        </>
      )}
    </>
  );
}

function HelixNumberRow(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <Row label={props.label}>
      <ClearableNumberField
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onCommit={props.onCommit}
        ariaLabel={props.ariaLabel}
        style={helixInputStyle}
      />
      <span style={rampUnitStyle}>{props.unit}</span>
    </Row>
  );
}

function Row(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <div style={valueStyle}>{props.children}</div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
};
const labelStyle: React.CSSProperties = {
  flex: '0 0 96px',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const valueStyle: React.CSSProperties = {
  display: 'flex',
  flex: '1 1 140px',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
};
const scallopInputStyle: React.CSSProperties = { width: 64, padding: '2px 6px' };
const directionSelectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 12,
  padding: '2px 4px',
};
const rampInputStyle: React.CSSProperties = { width: 52, padding: '2px 6px' };
const helixInputStyle: React.CSSProperties = { width: 72, padding: '2px 6px' };
const helixLabelStyle: React.CSSProperties = { fontSize: 12 };
const helixConflictStyle: React.CSSProperties = {
  margin: '0 0 4px 104px',
  fontSize: 11,
  lineHeight: 1.35,
  color: 'var(--lf-warning-fg)',
};
const rampUnitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
const reliefHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  padding: '2px 0 2px 4px',
  lineHeight: 1.35,
};
