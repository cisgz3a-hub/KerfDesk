// Taper fields for Rotary Setup (ADR-694), with LightBurn's Taper Warp inputs:
// Top diameter, Bottom diameter, Length, and which side the top is on. The
// gap from the top to the artwork says where on the part the design sits.

import type { RotaryTaper, RotaryTaperTopSide } from '../../core/devices/rotary';
import { NumberField } from '../common/NumberField';
import {
  hintStyle,
  numberStyle,
  panelStyle,
  segmentStyle,
  unitStyle,
} from './rotary-setup-dialog.styles';
import { displayRotaryMm } from './rotary-setup-edit';
import { editRotaryTaper, editTaperEnabled } from './rotary-taper-edit';
import type { RotaryEditUpdate } from './RotaryObjectFields';
import { FieldRow, RotaryNumberField, SegmentButton, ToggleRow } from './RotarySetupRows';

export function RotaryTaperFields(props: {
  readonly taper: RotaryTaper | undefined;
  readonly onEdit: RotaryEditUpdate;
}): JSX.Element {
  const { taper, onEdit } = props;
  const on = taper?.enabled === true;
  return (
    <>
      <ToggleRow
        checked={on}
        label="Tapered part (Taper Warp)"
        onChange={(enabled) => onEdit((edit) => editTaperEnabled(edit, enabled))}
      />
      {on && taper !== undefined ? (
        <TaperMeasurements taper={taper} onEdit={onEdit} />
      ) : (
        <p style={hintStyle}>
          Off: the artwork wraps a straight part of the Object diameter, so on a tumbler or glass
          that narrows its size round the part is right only where that diameter was measured. It
          comes out shorter where the part is narrower and longer where it is wider.
        </p>
      )}
    </>
  );
}

function TaperMeasurements(props: {
  readonly taper: RotaryTaper;
  readonly onEdit: RotaryEditUpdate;
}): JSX.Element {
  const { taper, onEdit } = props;
  const set = (patch: Parameters<typeof editRotaryTaper>[1]): void =>
    onEdit((edit) => editRotaryTaper(edit, patch));
  return (
    <div role="group" aria-label="Tapered part" style={panelStyle}>
      <TaperDiagram taper={taper} />
      <RotaryNumberField
        label="Top diameter"
        ariaLabel="Taper top diameter"
        title="Diameter of the part's top edge (a tumbler's rim)."
        value={displayRotaryMm(taper.topDiameterMm)}
        unit="mm"
        disabled={false}
        onCommit={(topDiameterMm) => set({ topDiameterMm })}
      />
      <RotaryNumberField
        label="Bottom diameter"
        ariaLabel="Taper bottom diameter"
        title="Diameter of the part's bottom edge (a tumbler's base)."
        value={displayRotaryMm(taper.bottomDiameterMm)}
        unit="mm"
        disabled={false}
        onCommit={(bottomDiameterMm) => set({ bottomDiameterMm })}
      />
      <RotaryNumberField
        label="Length"
        ariaLabel="Taper length"
        title="From the top edge to the bottom edge, measured along the side."
        value={displayRotaryMm(taper.lengthMm)}
        unit="mm"
        disabled={false}
        onCommit={(lengthMm) => set({ lengthMm })}
      />
      <TopSideField topSide={taper.topSide} onChange={(topSide) => set({ topSide })} />
      <FieldRow label="Artwork from top">
        <NumberField
          ariaLabel="Taper artwork from top"
          title="Along the side, from the part's top edge to the nearest edge of the artwork. Measure it on the part after Frame."
          value={displayRotaryMm(taper.artworkFromTopMm)}
          min={0}
          max={1000}
          step={0.5}
          debounceMs={0}
          onCommit={(artworkFromTopMm) => set({ artworkFromTopMm })}
          style={numberStyle}
        />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <p style={hintStyle}>
        Hold the part so the side being engraved is level with the bed (raise the narrow end). The
        artwork then keeps its size round the part at every height, and one turn stays one turn.
        Object diameter follows the wider end, as LightBurn advises; on a roller that is where the
        rollers drive the part. Focus still changes along a taper, and neither this nor
        LightBurn&apos;s Taper Warp corrects it: focus at the middle of the artwork, or keep the
        design short along the part.
      </p>
    </div>
  );
}

// LightBurn's Object Top, limited to the two sides a Y rotary's axis can face.
function TopSideField(props: {
  readonly topSide: RotaryTaperTopSide;
  readonly onChange: (topSide: RotaryTaperTopSide) => void;
}): JSX.Element {
  return (
    <FieldRow label="Top of the part">
      <div role="group" aria-label="Top of the part" style={segmentStyle}>
        <SegmentButton
          active={props.topSide === 'left'}
          title="The part's top points to the left of the bed."
          onClick={() => props.onChange('left')}
        >
          Left
        </SegmentButton>
        <SegmentButton
          active={props.topSide === 'right'}
          title="The part's top points to the right of the bed."
          onClick={() => props.onChange('right')}
        >
          Right
        </SegmentButton>
      </div>
    </FieldRow>
  );
}

// Side view of the part as it lies on the rotary: the top on its chosen side,
// the side being engraved level along the top of the drawing.
function TaperDiagram(props: { readonly taper: RotaryTaper }): JSX.Element {
  const { taper } = props;
  const largest = Math.max(taper.topDiameterMm, taper.bottomDiameterMm);
  const span = 52;
  const topH = (taper.topDiameterMm / largest) * span;
  const bottomH = (taper.bottomDiameterMm / largest) * span;
  const leftH = taper.topSide === 'left' ? topH : bottomH;
  const rightH = taper.topSide === 'left' ? bottomH : topH;
  const [x0, x1, y0] = [60, 300, 22];
  const artX = taper.topSide === 'left' ? x0 + 18 : x1 - 18 - 90;
  return (
    <svg
      viewBox="0 0 360 100"
      role="img"
      aria-label="Tapered part on the rotary, side view"
      style={{ width: '100%', maxHeight: 110 }}
    >
      <title>Tapered part, side view: the engraved side is level</title>
      <path
        d={`M${x0} ${y0} H${x1} V${y0 + rightH} L${x0} ${y0 + leftH} Z`}
        fill="var(--lf-bg-2)"
        stroke="var(--lf-border)"
      />
      <rect x={artX} y={y0 - 3} width="90" height="6" fill="var(--lf-accent)" fillOpacity="0.5" />
      <text x={x0 - 4} y={y0 + leftH / 2 + 4} textAnchor="end" fill="var(--lf-text)" fontSize="11">
        {taper.topSide === 'left' ? 'Top' : 'Bottom'}
      </text>
      <text x={x1 + 4} y={y0 + rightH / 2 + 4} fill="var(--lf-text)" fontSize="11">
        {taper.topSide === 'left' ? 'Bottom' : 'Top'}
      </text>
      <text x={(x0 + x1) / 2} y={y0 - 8} textAnchor="middle" fill="var(--lf-text)" fontSize="11">
        Level with the bed · Length {displayRotaryMm(taper.lengthMm)} mm
      </text>
      <text x={(x0 + x1) / 2} y="94" textAnchor="middle" fill="var(--lf-text-muted)" fontSize="10">
        Ø{displayRotaryMm(taper.topDiameterMm)} top · Ø{displayRotaryMm(taper.bottomDiameterMm)}{' '}
        bottom
      </text>
    </svg>
  );
}
