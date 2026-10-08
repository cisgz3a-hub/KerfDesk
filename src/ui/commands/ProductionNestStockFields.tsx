import { Button, NumberInput } from '../kit';
import type { ProductionNestStock } from '../../core/nesting/production-nest';
import { ProductionGrainField } from './ProductionNestPartFields';

type StockProps = {
  readonly stock: ProductionNestStock;
  readonly onChange: (stock: ProductionNestStock) => void;
  readonly onRemove: () => void;
};
export function ProductionNestStockFields({ stock, onChange, onRemove }: StockProps): JSX.Element {
  return (
    <fieldset style={{ display: 'grid', gap: 8 }}>
      <legend>{stock.name || stock.id}</legend>
      <label>
        Output sheet name{' '}
        <input
          title="Name this output sheet"
          value={stock.name}
          maxLength={200}
          onChange={(event) => onChange({ ...stock, name: event.currentTarget.value })}
        />
      </label>
      <label>
        Stock identifier{' '}
        <input
          title="Set the retained identifier for this stock item"
          value={stock.stockId}
          maxLength={200}
          onChange={(event) => onChange({ ...stock, stockId: event.currentTarget.value })}
        />
      </label>
      <label>
        Stock kind{' '}
        <select
          title="Choose a new sheet or rectangular remnant"
          value={stock.kind}
          onChange={(event) =>
            onChange({ ...stock, kind: event.currentTarget.value as ProductionNestStock['kind'] })
          }
        >
          <option value="sheet">New sheet</option>
          <option value="remnant">Rectangular remnant</option>
        </select>
      </label>
      <label>
        Stock material{' '}
        <input
          title="Set the material key used to match parts to this stock"
          aria-label={'Stock material ' + stock.id}
          value={stock.materialKey}
          maxLength={200}
          onChange={(event) => onChange({ ...stock, materialKey: event.currentTarget.value })}
        />
      </label>
      <StockDimensionFields stock={stock} onChange={onChange} />
      <ProductionGrainField
        label={'Stock grain ' + stock.id}
        value={stock.grain}
        onChange={(grain) => onChange({ ...stock, grain })}
      />
      <Button onClick={onRemove}>Remove stock sheet</Button>
    </fieldset>
  );
}
function StockDimensionFields({ stock, onChange }: Omit<StockProps, 'onRemove'>): JSX.Element {
  return (
    <>
      <label>
        Stock thickness (mm){' '}
        <NumberInput
          value={String(stock.thicknessMm)}
          min={0.01}
          step={0.1}
          onChange={(event) =>
            onChange({ ...stock, thicknessMm: Number(event.currentTarget.value) })
          }
        />
      </label>
      <label>
        Stock width (mm){' '}
        <NumberInput
          aria-label={'Stock width ' + stock.id}
          value={String(stock.widthMm)}
          min={0.01}
          step={1}
          onChange={(event) => onChange({ ...stock, widthMm: Number(event.currentTarget.value) })}
        />
      </label>
      <label>
        Stock height (mm){' '}
        <NumberInput
          aria-label={'Stock height ' + stock.id}
          value={String(stock.heightMm)}
          min={0.01}
          step={1}
          onChange={(event) => onChange({ ...stock, heightMm: Number(event.currentTarget.value) })}
        />
      </label>
    </>
  );
}
