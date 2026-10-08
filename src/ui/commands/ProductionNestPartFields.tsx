import { Button, NumberInput } from '../kit';
import type { ProductionGrain, ProductionNestPart } from '../../core/nesting/production-nest';
import type { NestRotation } from '../../core/nesting/quick-nest';

type PartProps = {
  readonly part: ProductionNestPart;
  readonly onChange: (part: ProductionNestPart) => void;
  readonly onRemove: () => void;
};
export function ProductionNestPartFields(props: PartProps): JSX.Element {
  const { part, onChange } = props;
  return (
    <fieldset style={{ display: 'grid', gap: 8 }}>
      <legend>
        {part.name || part.id} · {part.objectIds.length} attached artwork object(s)
      </legend>
      <label>
        Part name{' '}
        <input
          title="Name this production part"
          value={part.name}
          maxLength={200}
          onChange={(event) => onChange({ ...part, name: event.currentTarget.value })}
        />
      </label>
      <label>
        Requested quantity{' '}
        <NumberInput
          aria-label={'Quantity ' + part.id}
          value={String(part.quantity)}
          min={1}
          max={10000}
          step={1}
          onChange={(event) => onChange({ ...part, quantity: Number(event.currentTarget.value) })}
        />
      </label>
      <label>
        Part material{' '}
        <input
          title="Match this part to stock with the same material key"
          aria-label={'Part material ' + part.id}
          value={part.materialKey}
          maxLength={200}
          onChange={(event) => onChange({ ...part, materialKey: event.currentTarget.value })}
        />
      </label>
      <label>
        Part thickness (mm){' '}
        <NumberInput
          value={String(part.thicknessMm)}
          min={0.01}
          step={0.1}
          onChange={(event) =>
            onChange({ ...part, thicknessMm: Number(event.currentTarget.value) })
          }
        />
      </label>
      <ProductionGrainField
        label={'Part grain ' + part.id}
        value={part.grain}
        onChange={(grain) => onChange({ ...part, grain })}
      />
      <ProductionTurnFields {...props} />
      <Button onClick={props.onRemove}>Remove part</Button>
    </fieldset>
  );
}
function ProductionTurnFields({ part, onChange }: PartProps): JSX.Element {
  const turn = (angle: NestRotation, checked: boolean): void =>
    onChange({
      ...part,
      rotationAngles: checked
        ? [...part.rotationAngles, angle]
        : part.rotationAngles.filter((current) => current !== angle),
    });
  return (
    <div
      role="group"
      aria-label={'Permitted turns ' + part.id}
      style={{ display: 'flex', gap: 12 }}
    >
      {([0, 90, 180, 270] as const).map((angle) => (
        <label key={angle}>
          <input
            title={'Allow this part to rotate by ' + angle + ' degrees during nesting'}
            type="checkbox"
            checked={part.rotationAngles.includes(angle)}
            onChange={(event) => turn(angle, event.currentTarget.checked)}
          />{' '}
          {angle}°
        </label>
      ))}
    </div>
  );
}
export function ProductionGrainField(props: {
  readonly label: string;
  readonly value: ProductionGrain;
  readonly onChange: (grain: ProductionGrain) => void;
}): JSX.Element {
  return (
    <label>
      {props.label}{' '}
      <select
        title={props.label + ': choose the required grain direction'}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value as ProductionGrain)}
      >
        <option value="none">No grain constraint</option>
        <option value="x">Along X</option>
        <option value="y">Along Y</option>
      </select>
    </label>
  );
}
