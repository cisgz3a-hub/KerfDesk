import type { NoGoZone } from '../../core/devices';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { Button } from '../kit';
import { useStore } from '../state';
import {
  buttonRowStyle,
  cardStyle,
  inlineLabelStyle,
  mutedStyle,
  numberInputStyle,
  stackStyle,
  zoneGridStyle,
} from './MachineSetupStyles';

export function SafetyZonesPanel(): JSX.Element {
  const device = useStore((s) => s.project.device);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const zones = device.noGoZones;
  const updateZones = (noGoZones: ReadonlyArray<NoGoZone>): void =>
    updateDeviceProfile({ noGoZones });
  return (
    <div style={stackStyle}>
      <div style={buttonRowStyle}>
        <Button onClick={() => updateZones([...zones, defaultZone(zones.length)])}>Add zone</Button>
      </div>
      {zones.length === 0 ? <p style={mutedStyle}>No safety zones configured.</p> : null}
      {zones.map((zone, index) => (
        <ZoneEditor
          key={zone.id}
          zone={zone}
          index={index}
          onChange={(next) => updateZones(zones.map((item) => (item.id === zone.id ? next : item)))}
          onRemove={() => updateZones(zones.filter((item) => item.id !== zone.id))}
        />
      ))}
    </div>
  );
}

function ZoneEditor(props: {
  readonly zone: NoGoZone;
  readonly index: number;
  readonly onChange: (zone: NoGoZone) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const { zone } = props;
  return (
    <article style={cardStyle}>
      <div style={zoneGridStyle}>
        <label>
          <span>Name</span>
          <input
            aria-label={`Safety zone ${props.index + 1} name`}
            title="Name this machine-coordinate safety zone."
            value={zone.name}
            onChange={(event) => props.onChange({ ...zone, name: event.target.value })}
          />
        </label>
        <label>
          <span>X</span>
          <NumberField
            label={`Safety zone ${props.index + 1} x`}
            value={zone.x}
            onChange={(x) => props.onChange({ ...zone, x })}
          />
        </label>
        <label>
          <span>Y</span>
          <NumberField
            label={`Safety zone ${props.index + 1} y`}
            value={zone.y}
            onChange={(y) => props.onChange({ ...zone, y })}
          />
        </label>
        <label>
          <span>W</span>
          <NumberField
            label={`Safety zone ${props.index + 1} width`}
            value={zone.width}
            min={0.1}
            onChange={(width) => props.onChange({ ...zone, width: Math.max(0.1, width) })}
          />
        </label>
        <label>
          <span>H</span>
          <NumberField
            label={`Safety zone ${props.index + 1} height`}
            value={zone.height}
            min={0.1}
            onChange={(height) => props.onChange({ ...zone, height: Math.max(0.1, height) })}
          />
        </label>
        <label style={inlineLabelStyle}>
          <input
            type="checkbox"
            checked={zone.enabled}
            onChange={(event) => props.onChange({ ...zone, enabled: event.target.checked })}
            title="Enable or disable this safety zone."
          />
          Enabled
        </label>
        <Button variant="danger" onClick={props.onRemove}>
          Remove
        </Button>
      </div>
    </article>
  );
}

const SAFETY_ZONE_MAX_MM = 100000;

function NumberField(props: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <ClearableNumberField
      ariaLabel={props.label}
      title={props.label}
      value={props.value}
      min={props.min ?? 0}
      max={SAFETY_ZONE_MAX_MM}
      step={1}
      onCommit={props.onChange}
      style={numberInputStyle}
      debounceMs={0}
    />
  );
}

function defaultZone(index: number): NoGoZone {
  return {
    id: `zone-${Date.now()}-${index + 1}`,
    name: `Safety zone ${index + 1}`,
    enabled: true,
    x: 0,
    y: 0,
    width: 20,
    height: 20,
  };
}
