import {
  effectiveBidirectionalScanPolicy,
  type BidirectionalScanPolicy,
  type DeviceProfile,
} from '../../core/devices/device-profile';
import { Row } from './device-settings-shared';

export function ScanDirectionPolicyEditor(props: {
  readonly profile: DeviceProfile;
  readonly onChange: (value: BidirectionalScanPolicy) => void;
  readonly withRow?: boolean;
}): JSX.Element {
  const control = (
    <div style={stackStyle}>
      <select
        className="lf-input"
        aria-label="Bidirectional scan policy"
        title="Choose whether bidirectional scanning requires verified scan-offset calibration"
        value={effectiveBidirectionalScanPolicy(props.profile)}
        onChange={(event) => props.onChange(parsePolicy(event.target.value))}
      >
        <option value="allow-requested">Allow requested direction</option>
        <option value="require-verified-offsets">Require verified offsets</option>
      </select>
      <span style={noteStyle}>
        Requiring verification makes ordinary requested bidirectional scans fall back to one-way
        until a saved table is marked verified. Calibration coupons and explicit expert overrides
        retain their documented behavior.
      </span>
    </div>
  );
  return props.withRow === false ? control : <Row label="Scan direction policy">{control}</Row>;
}

function parsePolicy(value: string): BidirectionalScanPolicy {
  return value === 'require-verified-offsets' ? value : 'allow-requested';
}

const stackStyle: React.CSSProperties = { display: 'grid', gap: 4 };
const noteStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 11 };
