import type { CncMachineConfig, CncStock } from '../../../core/scene';
// Deep import: core/scene's barrel is a ratcheted over-cap legacy barrel.
import { setStockThicknessMm } from '../../../core/scene/machine';
import { NumberField } from '../../common/NumberField';
import { Button } from '../../kit';
import { Row, unitStyle } from '../device-settings-shared';

/**
 * ADR-258 Amendment 6 (CNC audit J1-P3-3): the field shows the shipped
 * thickness until a value is committed, and entering the value it already
 * shows commits nothing, so a real sheet of that thickness is confirmed here.
 * Until then the holding tabs are measured from the cut floor.
 */
function UnsetThicknessNote(props: {
  readonly thicknessMm: number;
  readonly onConfirm: () => void;
}): JSX.Element {
  return (
    <div style={noteStyle} role="note">
      <span>Stock thickness not set yet: holding tabs are measured from the cut floor.</span>
      <Button
        onClick={props.onConfirm}
        title="My stock really is this thick: measure holding tabs from the stock bottom"
      >
        Use {props.thicknessMm} mm
      </Button>
    </div>
  );
}

const noteStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};

export function DeviceSetupCncStockFields(props: {
  readonly machine: CncMachineConfig;
  readonly onChange: (stock: CncStock) => void;
}): JSX.Element {
  const { stock } = props.machine;
  const edit = (patch: Partial<CncStock>): void => props.onChange({ ...stock, ...patch });
  return (
    <div style={fieldsStyle}>
      <StockNumberRow
        label="Stock thickness"
        value={stock.thicknessMm}
        min={0.1}
        max={200}
        step={0.05}
        // ADR-258 Amendment 6: a committed thickness is set, even 6.35 mm.
        onCommit={(thicknessMm) => edit({ thicknessMm, thicknessSet: true })}
      />
      {setStockThicknessMm(stock) === undefined ? (
        <UnsetThicknessNote
          thicknessMm={stock.thicknessMm}
          onConfirm={() => edit({ thicknessSet: true })}
        />
      ) : null}
      <StockNumberRow
        label="Stock width"
        value={stock.widthMm}
        min={1}
        max={1500}
        step={1}
        onCommit={(widthMm) => edit({ widthMm })}
      />
      <StockNumberRow
        label="Stock height"
        value={stock.heightMm}
        min={1}
        max={1500}
        step={1}
        onCommit={(heightMm) => edit({ heightMm })}
      />
      <StockNumberRow
        label="Stock origin X"
        value={stock.originOffset.x}
        min={-1500}
        max={1500}
        step={1}
        onCommit={(x) => edit({ originOffset: { ...stock.originOffset, x } })}
      />
      <StockNumberRow
        label="Stock origin Y"
        value={stock.originOffset.y}
        min={-1500}
        max={1500}
        step={1}
        onCommit={(y) => edit({ originOffset: { ...stock.originOffset, y } })}
      />
    </div>
  );
}

function StockNumberRow(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <Row label={props.label}>
      <NumberField
        ariaLabel={props.label}
        title={props.label}
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onCommit={props.onCommit}
        debounceMs={0}
        style={numberStyle}
      />
      <span style={unitStyle}>mm</span>
    </Row>
  );
}

const fieldsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(225px, 1fr))',
  gap: '6px 14px',
};
const numberStyle: React.CSSProperties = { width: 84 };
