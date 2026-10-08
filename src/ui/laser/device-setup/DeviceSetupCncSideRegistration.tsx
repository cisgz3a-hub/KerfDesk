import type { CncStock } from '../../../core/scene/machine';
import type { CncTwoSidedSetup } from '../../../core/scene/cnc-two-sided-setup';
import type { Vec2 } from '../../../core/scene/scene-object';
import { cncSideRegistrationPoints } from '../../../core/cnc/cnc-two-sided-setup';

type RegistrationFeature = CncTwoSidedSetup['registration'][number];

export function DeviceSetupCncSideRegistration(props: {
  readonly side: CncTwoSidedSetup;
  readonly stock: CncStock;
  readonly onChange: (side: CncTwoSidedSetup) => void;
}): JSX.Element {
  const { side, stock, onChange } = props;
  return (
    <>
      {side.registration.map((feature) => (
        <RegistrationFeatureEditor
          key={feature.id}
          feature={feature}
          onChange={(patch) =>
            onChange({
              ...side,
              registration: side.registration.map((item) =>
                item.id === feature.id ? { ...item, ...patch } : item,
              ),
            })
          }
          onRemove={() =>
            onChange({
              ...side,
              registration: side.registration.filter((item) => item.id !== feature.id),
            })
          }
        />
      ))}
      <button
        title="Add a retained stock-local registration guide"
        type="button"
        disabled={side.registration.length >= 128}
        onClick={() =>
          onChange({
            ...side,
            registration: [
              ...side.registration,
              newRegistrationFeature(stock, side.registration.length),
            ],
          })
        }
      >
        Add registration guide
      </button>
    </>
  );
}

function RegistrationFeatureEditor(props: {
  readonly feature: RegistrationFeature;
  readonly onChange: (patch: Partial<RegistrationFeature>) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const { feature, onChange, onRemove } = props;
  return (
    <fieldset>
      <legend>{feature.name}</legend>
      <label>
        Name{' '}
        <input
          title="Name this registration feature"
          aria-label={'Registration name ' + feature.id}
          value={feature.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </label>
      {REGISTRATION_FIELDS.map(([key, label]) => (
        <label key={key}>
          {label} mm{' '}
          <input
            title={label + ' in millimetres'}
            type="number"
            aria-label={'Registration ' + key + ' ' + feature.id}
            value={feature[key]}
            onChange={(event) => onChange({ [key]: event.target.valueAsNumber })}
          />
        </label>
      ))}
      <button
        title="Remove this registration feature from the setup"
        type="button"
        onClick={onRemove}
      >
        Remove registration feature
      </button>
    </fieldset>
  );
}

function newRegistrationFeature(stock: CncStock, count: number): RegistrationFeature {
  return {
    id: crypto.randomUUID(),
    name: 'Registration ' + (count + 1),
    stockXMm: stock.widthMm / 4,
    stockYMm: stock.heightMm / 2,
    diameterMm: 4,
  };
}

export function DeviceSetupCncSidePreviews(props: {
  readonly stock: CncStock;
  readonly side: CncTwoSidedSetup;
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {(['A', 'B'] as const).map((which) => (
        <SidePreview key={which} stock={props.stock} side={{ ...props.side, activeSide: which }} />
      ))}
    </div>
  );
}

function SidePreview({
  stock,
  side,
}: {
  readonly stock: CncStock;
  readonly side: CncTwoSidedSetup;
}): JSX.Element {
  const guides = registrationPreviewGuides(stock, side);
  const origin = side.activeSide === 'A' ? stock.originOffset : side.sideBStockOriginMm;
  return (
    <figure style={{ margin: 0 }}>
      <figcaption>
        Side {side.activeSide} · G54 · top Z0 · stock origin {origin.x}, {origin.y} mm
      </figcaption>
      <svg
        role="img"
        aria-label={'Side ' + side.activeSide + ' stock and registration'}
        viewBox={'0 0 ' + stock.widthMm + ' ' + stock.heightMm}
        style={{ width: '100%', maxHeight: 180 }}
      >
        <rect
          width={stock.widthMm}
          height={stock.heightMm}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {guides.map(({ feature, point }) => (
          <circle
            key={feature.id}
            cx={point.x - origin.x}
            cy={stock.heightMm - (point.y - origin.y)}
            r={feature.diameterMm / 2}
            fill="none"
            stroke="var(--lf-warning-fg)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </figure>
  );
}

function registrationPreviewGuides(
  stock: CncStock,
  side: CncTwoSidedSetup,
): ReadonlyArray<{ readonly feature: RegistrationFeature; readonly point: Vec2 }> {
  const points = cncSideRegistrationPoints(stock, side);
  return side.registration.map((feature, index) => {
    const point = points[index];
    if (point === undefined)
      throw new RangeError(`Missing registration coordinate for ${feature.id}`);
    return { feature, point };
  });
}

const REGISTRATION_FIELDS = [
  ['stockXMm', 'Stock X'],
  ['stockYMm', 'Stock Y'],
  ['diameterMm', 'Diameter'],
] as const;
