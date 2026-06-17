import type { NoGoZone } from '../../core/devices';
import { useStore } from '../state';
import { Button } from '../kit';

export function SafetyZonesPanel(): JSX.Element {
  const zones = useStore((state) => state.project.device.noGoZones ?? []);
  const updateDeviceProfile = useStore((state) => state.updateDeviceProfile);
  const updateZones = (next: ReadonlyArray<NoGoZone>) => updateDeviceProfile({ noGoZones: next });
  return (
    <div style={stackStyle}>
      <p style={copyStyle}>
        Rectangular no-go zones are machine-coordinate keep-outs for clamps, fixtures, and blocked
        travel. They are not scene objects and are checked by Start, Frame, and G-code export
        preflight.
      </p>
      <Button
        onClick={() =>
          updateZones([
            ...zones,
            {
              id: `zone-${Date.now()}`,
              name: 'No-go zone',
              enabled: true,
              x: 0,
              y: 0,
              width: 10,
              height: 10,
            },
          ])
        }
      >
        Add zone
      </Button>
      {zones.length === 0 ? <p style={copyStyle}>No safety zones configured.</p> : null}
      {zones.map((zone, index) => (
        <ZoneRow
          key={zone.id}
          zone={zone}
          onChange={(patch) => updateZones(replaceZone(zones, index, { ...zone, ...patch }))}
          onDelete={() => updateZones(zones.filter((candidate) => candidate.id !== zone.id))}
        />
      ))}
    </div>
  );
}

function ZoneRow(props: {
  readonly zone: NoGoZone;
  readonly onChange: (patch: Partial<NoGoZone>) => void;
  readonly onDelete: () => void;
}): JSX.Element {
  const { zone } = props;
  return (
    <section style={rowStyle}>
      <label style={checkStyle}>
        <input
          type="checkbox"
          checked={zone.enabled}
          onChange={(event) => props.onChange({ enabled: event.target.checked })}
          title="Enable or disable this no-go zone."
        />
        enabled
      </label>
      <input
        type="text"
        value={zone.name}
        onChange={(event) => props.onChange({ name: event.target.value })}
        aria-label="Safety zone name"
        title="Name for this no-go zone."
      />
      <NumberInput label="X" value={zone.x} onChange={(x) => props.onChange({ x })} />
      <NumberInput label="Y" value={zone.y} onChange={(y) => props.onChange({ y })} />
      <NumberInput label="W" value={zone.width} onChange={(width) => props.onChange({ width })} />
      <NumberInput label="H" value={zone.height} onChange={(height) => props.onChange({ height })} />
      <Button onClick={props.onDelete}>Delete</Button>
    </section>
  );
}

function NumberInput(props: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label style={numberLabelStyle}>
      {props.label}
      <input
        type="number"
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value) || 0)}
        title={`${props.label} coordinate or size in machine millimeters.`}
        style={numberStyle}
      />
    </label>
  );
}

function replaceZone(
  zones: ReadonlyArray<NoGoZone>,
  index: number,
  next: NoGoZone,
): ReadonlyArray<NoGoZone> {
  return zones.map((zone, zoneIndex) => (zoneIndex === index ? next : zone));
}

const stackStyle: React.CSSProperties = { display: 'grid', gap: 8 };
const copyStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', margin: 0, lineHeight: 1.35 };
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(130px, 1fr) repeat(4, 72px) auto',
  gap: 6,
  alignItems: 'center',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 8,
};
const checkStyle: React.CSSProperties = { display: 'inline-flex', gap: 4, alignItems: 'center' };
const numberLabelStyle: React.CSSProperties = { display: 'grid', gap: 2, fontSize: 11 };
const numberStyle: React.CSSProperties = { width: 64 };
