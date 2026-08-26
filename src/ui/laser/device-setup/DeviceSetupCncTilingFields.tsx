import { DEFAULT_CNC_TILING, type CncTiling } from '../../../core/scene';
import { NumberField } from '../../common/NumberField';
import { CncTilingDisclosure, cncTilingAfterEdit } from '../../machine/CncTilingDisclosure';
import { Row, unitStyle } from '../device-settings-shared';

export function DeviceSetupCncTilingFields(props: {
  readonly tiling: CncTiling | undefined;
  readonly onChange: (tiling: CncTiling | undefined) => void;
}): JSX.Element {
  const edit = (patch: Partial<CncTiling>): void => {
    if (props.tiling === undefined) return;
    props.onChange(cncTilingAfterEdit(props.tiling, patch));
  };
  return (
    <div style={stackStyle}>
      <label style={checkRowStyle}>
        <input
          type="checkbox"
          checked={props.tiling !== undefined}
          onChange={(event) =>
            props.onChange(event.target.checked ? DEFAULT_CNC_TILING : undefined)
          }
          aria-label="Enable tiling"
          title="Stage indexed multi-file tiling for this CNC job."
        />
        <span>Split this job into indexed tiles on export</span>
      </label>
      {props.tiling === undefined ? null : (
        <>
          <TilingNumberRow
            label="Tile width"
            value={props.tiling.tileWidthMm}
            min={20}
            max={1500}
            onCommit={(tileWidthMm) => edit({ tileWidthMm })}
          />
          <TilingNumberRow
            label="Tile height"
            value={props.tiling.tileHeightMm}
            min={20}
            max={1500}
            onCommit={(tileHeightMm) => edit({ tileHeightMm })}
          />
          <TilingNumberRow
            label="Overlap"
            value={props.tiling.overlapMm}
            min={0}
            max={100}
            onCommit={(overlapMm) => edit({ overlapMm })}
          />
          <label style={checkRowStyle}>
            <input
              type="checkbox"
              checked={props.tiling.registrationHoles}
              onChange={(event) => edit({ registrationHoles: event.target.checked })}
              aria-label="Drill registration holes"
              title="Include registration holes in tile overlap strips."
            />
            <span>Drill registration holes in overlap strips</span>
          </label>
          <CncTilingDisclosure tiling={props.tiling} />
        </>
      )}
    </div>
  );
}

function TilingNumberRow(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <Row label={props.label}>
      <NumberField
        ariaLabel={props.label}
        value={props.value}
        min={props.min}
        max={props.max}
        onCommit={props.onCommit}
        debounceMs={0}
        style={numberStyle}
      />
      <span style={unitStyle}>mm</span>
    </Row>
  );
}

const stackStyle: React.CSSProperties = { display: 'grid', gap: 6 };
const checkRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
const numberStyle: React.CSSProperties = { width: 84 };
