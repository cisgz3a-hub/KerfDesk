import type { CncMachineConfig, CncStock } from '../../../core/scene';
import { NumberField } from '../../common/NumberField';
import { Row, unitStyle } from '../device-settings-shared';

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
        onCommit={(thicknessMm) => edit({ thicknessMm })}
      />
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
