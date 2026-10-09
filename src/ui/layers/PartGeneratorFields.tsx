import type { PartGeneratorDefinition, PartGeneratorKind } from '../../core/parts/part-generator';
import { defaultPartGenerator } from '../../core/parts/part-generator';

export function PartGeneratorFields(props: {
  readonly definition: PartGeneratorDefinition;
  readonly onChange: (definition: PartGeneratorDefinition) => void;
}): JSX.Element {
  const definition = props.definition;
  return (
    <fieldset>
      <legend>Named part dimensions</legend>
      <label>
        Part type{' '}
        <select
          title="Choose the retained part generator and its dimension fields"
          value={definition.kind}
          onChange={(event) =>
            props.onChange(defaultPartGenerator(event.currentTarget.value as PartGeneratorKind))
          }
        >
          <option value="panel">Panel</option>
          <option value="bracket">Bracket</option>
          <option value="hole-grid">Hole grid</option>
          <option value="fixture">Fixture</option>
        </select>
      </label>
      <label>
        Part name{' '}
        <input
          title="Name this generated part"
          value={definition.name}
          maxLength={200}
          onChange={(event) => props.onChange({ ...definition, name: event.currentTarget.value })}
        />
      </label>
      <div className="lf-authoring-dimensions">
        {dimensionFields(definition).map((field) => (
          <label key={field.key}>
            {field.label}{' '}
            <input
              title={field.label}
              type="number"
              min={field.count ? 1 : 0.001}
              max={field.count ? 32 : 100000}
              step={field.count ? 1 : 'any'}
              value={Number.isFinite(field.value) ? field.value : ''}
              onChange={(event) =>
                props.onChange({
                  ...definition,
                  [field.key]:
                    event.currentTarget.value === '' ? NaN : Number(event.currentTarget.value),
                })
              }
            />
          </label>
        ))}
      </div>
      {definition.kind === 'hole-grid' || definition.kind === 'fixture' ? (
        <p className="lf-authoring-hint">A single row or column centres its holes on that axis.</p>
      ) : null}
      <p className="lf-authoring-hint">
        Hole grids contain at most 512 holes. Holes must fit inside the boundary without touching or
        overlapping.
      </p>
    </fieldset>
  );
}
type DimensionField = {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly count?: boolean;
};
function dimensionFields(definition: PartGeneratorDefinition): readonly DimensionField[] {
  const common: DimensionField[] = [
    { key: 'widthMm', label: 'Overall width (mm)', value: definition.widthMm },
    { key: 'heightMm', label: 'Overall height (mm)', value: definition.heightMm },
    { key: 'holeDiameterMm', label: 'Hole diameter (mm)', value: definition.holeDiameterMm },
  ];
  if (definition.kind === 'bracket')
    return [
      ...common,
      { key: 'legWidthMm', label: 'Bracket leg width (mm)', value: definition.legWidthMm },
      {
        key: 'holeOffsetMm',
        label: 'Hole offset from leg end (mm)',
        value: definition.holeOffsetMm,
      },
    ];
  common.push({
    key: 'edgeOffsetMm',
    label: 'Hole centre edge offset (mm)',
    value: definition.edgeOffsetMm,
  });
  if (definition.kind === 'panel') return common;
  common.push(
    { key: 'rows', label: 'Hole rows', value: definition.rows, count: true },
    { key: 'columns', label: 'Hole columns', value: definition.columns, count: true },
  );
  if (definition.kind === 'fixture')
    common.push(
      {
        key: 'mountOffsetMm',
        label: 'Mounting hole edge offset (mm)',
        value: definition.mountOffsetMm,
      },
      {
        key: 'mountDiameterMm',
        label: 'Mounting hole diameter (mm)',
        value: definition.mountDiameterMm,
      },
    );
  return common;
}
