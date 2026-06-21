// F-7: surface auto-detected machine settings from the `$$` dump.
// Safe numeric profile values can be applied from the banner. Hardware
// capability hints stay review-only until the operator confirms the machine.

import type { ControllerSettingsSnapshot, GrblSettingRow } from '../../core/controllers/grbl';
import {
  profileSupportsCapability,
  type DeviceProfile,
  type ProfileCapability,
} from '../../core/devices';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';

export function DetectedSettingsBanner(): JSX.Element | null {
  const detected = useLaserStore((s) => s.detectedSettings);
  const apply = useLaserStore((s) => s.applyDetectedSettings);
  const dismiss = useLaserStore((s) => s.dismissDetectedSettings);
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const settingsRows = useLaserStore((s) => s.grblSettingsRows);
  const current = useStore((s) => s.project.device);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  if (detected === null) return null;
  const rows = describePatch(detected, current);
  const review = describeReviewItems(detected, current, controllerSettings ?? {}, settingsRows);
  if (rows.length === 0 && review.needsReview.length === 0 && review.ignored.length === 0) {
    return null;
  }
  return (
    <div style={panelStyle} role="region" aria-label="Detected machine settings">
      <strong style={titleStyle}>Detected machine settings review</strong>
      <p style={hintStyle}>
        Your laser reported these values via <code>$$</code>. Safe profile values can be applied;
        hardware capabilities stay review-only until you confirm the machine.
      </p>
      {rows.length > 0 ? <PatchRows rows={rows} /> : null}
      <ReviewSection
        title="Needs review"
        items={review.needsReview}
        onApplyAction={(patch) => updateDeviceProfile(patch)}
      />
      <ReviewSection title="Ignored" items={review.ignored} />
      <div style={actionsStyle}>
        <button
          type="button"
          onClick={dismiss}
          title="Ignore these detected firmware settings for now."
        >
          Dismiss
        </button>
        {rows.length > 0 ? (
          <button
            type="button"
            onClick={apply}
            style={primaryButtonStyle}
            title="Apply only the safe detected firmware settings to this device profile."
          >
            Apply safe settings
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PatchRows({ rows }: { readonly rows: ReadonlyArray<Row> }): JSX.Element {
  return (
    <section>
      <strong style={sectionTitleStyle}>Safe profile updates</strong>
      <ul style={listStyle}>
        {rows.map((r) => (
          <li key={r.label} style={rowStyle}>
            <span style={rowLabelStyle}>{r.label}</span>
            <span style={rowValueStyle}>
              <span style={oldStyle}>{r.oldText}</span>
              <span aria-hidden style={arrowStyle}>
                -&gt;
              </span>
              <span style={newStyle}>{r.newText}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewSection(props: {
  readonly title: string;
  readonly items: ReadonlyArray<ReviewItem>;
  readonly onApplyAction?: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element | null {
  if (props.items.length === 0) return null;
  return (
    <section>
      <strong style={sectionTitleStyle}>{props.title}</strong>
      <ul style={listStyle}>
        {props.items.map((item) => {
          const action = item.action;
          return (
            <li key={item.label} style={reviewRowStyle}>
              <span style={rowLabelStyle}>{item.label}</span>
              <span style={reviewDetailStyle}>
                <span>{item.detail}</span>
                {action === undefined || props.onApplyAction === undefined ? null : (
                  <button
                    type="button"
                    style={reviewActionButtonStyle}
                    title={action.title}
                    onClick={() => props.onApplyAction?.(action.patch)}
                  >
                    {action.label}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type Row = {
  readonly label: string;
  readonly oldText: string;
  readonly newText: string;
  readonly changed: boolean;
};

type ReviewItem = {
  readonly label: string;
  readonly detail: string;
  readonly action?: ReviewAction;
};

type ReviewAction = {
  readonly label: string;
  readonly title: string;
  readonly patch: Partial<DeviceProfile>;
};

type ReviewSummary = {
  readonly needsReview: ReadonlyArray<ReviewItem>;
  readonly ignored: ReadonlyArray<ReviewItem>;
};

export function describePatch(
  patch: Partial<DeviceProfile>,
  current: DeviceProfile,
): ReadonlyArray<Row> {
  const rows: Row[] = [];
  pushNumericRow(rows, 'Bed width', patch.bedWidth, current.bedWidth, formatMm);
  pushNumericRow(rows, 'Bed height', patch.bedHeight, current.bedHeight, formatMm);
  pushOptionalNumericRow(rows, 'Z travel', patch.zTravelMm, current.zTravelMm, formatMm);
  pushNumericRow(rows, 'Max feed', patch.maxFeed, current.maxFeed, formatFeed);
  pushNumericRow(rows, 'Max power (S)', patch.maxPowerS, current.maxPowerS, formatInt);
  pushNumericRow(rows, 'Min power (S)', patch.minPowerS, current.minPowerS, formatInt);
  pushBooleanRow(
    rows,
    'Laser mode ($32)',
    patch.laserModeEnabled,
    current.laserModeEnabled,
    formatLaserMode,
  );
  pushNumericRow(rows, 'Acceleration', patch.accelMmPerSec2, current.accelMmPerSec2, formatAccel);
  pushNumericRow(
    rows,
    'Junction deviation',
    patch.junctionDeviationMm,
    current.junctionDeviationMm,
    formatMm,
  );
  return rows;
}

export function describeReviewItems(
  patch: Partial<DeviceProfile>,
  current: DeviceProfile,
  controller: ControllerSettingsSnapshot,
  settingsRows: ReadonlyArray<GrblSettingRow>,
): ReviewSummary {
  const needsReview: ReviewItem[] = [];
  const ignored: ReviewItem[] = [];
  const detectedZTravelMm = controller.zTravelMm ?? patch.zTravelMm;
  if (
    isPositive(controller.zMaxFeed) &&
    isPositive(detectedZTravelMm) &&
    !profileSupportsCapability(current, 'z-axis')
  ) {
    needsReview.push({
      label: 'Powered Z jog',
      detail:
        'Controller reports Z travel and Z max rate. Confirm the machine has a motorized Z/focus axis before enabling Z jog buttons.',
      action: {
        label: 'Mark profile as powered Z',
        title: 'Adds powered Z capability but keeps Z jog blocked until travel is confirmed.',
        patch: {
          capabilities: addCapability(current.capabilities, 'z-axis'),
          zTravelMm: detectedZTravelMm,
          zTravelConfirmed: false,
        },
      },
    });
  }
  pushBooleanReview(
    needsReview,
    'Soft limits ($20)',
    controller.softLimitsEnabled,
    'Firmware soft-limit behavior is controller-side. Confirm bed size, origin, and homing before relying on it.',
  );
  pushBooleanReview(
    needsReview,
    'Hard limits ($21)',
    controller.hardLimitsEnabled,
    'Physical limit switch behavior cannot be verified from $$ alone.',
  );
  pushBooleanReview(
    needsReview,
    'Homing cycle ($22)',
    controller.homingEnabled,
    'Confirm switch wiring and home direction before enabling homing-dependent workflows.',
  );
  if (controller.homingDirectionMask !== undefined) {
    needsReview.push({
      label: 'Homing direction mask ($23)',
      detail: `Controller reports mask ${controller.homingDirectionMask}. Review the machine documentation before mapping this to a LaserForge home corner.`,
    });
  }
  for (const row of settingsRows) {
    if (row.known) continue;
    ignored.push({
      label: row.code,
      detail: 'Unknown GRBL setting was read but not applied to the LaserForge profile.',
    });
  }
  return { needsReview, ignored };
}

function pushBooleanReview(
  rows: ReviewItem[],
  label: string,
  value: boolean | undefined,
  suffix: string,
): void {
  if (value === undefined) return;
  rows.push({
    label,
    detail: `Controller reports ${value ? 'enabled' : 'disabled'}. ${suffix}`,
  });
}

function pushBooleanRow(
  rows: Row[],
  label: string,
  next: boolean | undefined,
  prev: boolean,
  format: (value: boolean) => string,
): void {
  if (next === undefined) return;
  if (next === prev) return;
  rows.push({
    label,
    oldText: format(prev),
    newText: format(next),
    changed: true,
  });
}

function pushNumericRow(
  rows: Row[],
  label: string,
  next: number | undefined,
  prev: number,
  format: (n: number) => string,
): void {
  if (next === undefined) return;
  if (numbersClose(next, prev)) return;
  rows.push({
    label,
    oldText: format(prev),
    newText: format(next),
    changed: true,
  });
}

function pushOptionalNumericRow(
  rows: Row[],
  label: string,
  next: number | undefined,
  prev: number | undefined,
  format: (n: number) => string,
): void {
  if (next === undefined) return;
  if (prev !== undefined && numbersClose(next, prev)) return;
  rows.push({
    label,
    oldText: prev === undefined ? 'Not set' : format(prev),
    newText: format(next),
    changed: true,
  });
}

function numbersClose(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  if (diff < 0.001) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return diff / denom < 0.001;
}

function isPositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function addCapability(
  capabilities: ReadonlyArray<ProfileCapability> | undefined,
  capability: ProfileCapability,
): ReadonlyArray<ProfileCapability> {
  if (capabilities?.includes(capability) === true) return capabilities;
  return [...(capabilities ?? []), capability];
}

function formatMm(n: number): string {
  return `${n.toFixed(3)} mm`;
}

function formatFeed(n: number): string {
  return `${Math.round(n)} mm/min`;
}

function formatInt(n: number): string {
  return `${Math.round(n)}`;
}

function formatAccel(n: number): string {
  return `${Math.round(n)} mm/s^2`;
}

function formatLaserMode(enabled: boolean): string {
  return enabled ? 'Enabled' : 'Disabled';
}

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--lf-accent)',
  background: 'var(--lf-tint-info)',
  padding: 8,
  borderRadius: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const titleStyle: React.CSSProperties = { fontSize: 13, color: 'var(--lf-accent-fg)' };
const sectionTitleStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text)' };
const hintStyle: React.CSSProperties = {
  margin: '2px 0 4px 0',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
const listStyle: React.CSSProperties = { margin: 0, padding: 0, listStyle: 'none', fontSize: 12 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  padding: '2px 0',
};
const reviewRowStyle: React.CSSProperties = {
  ...rowStyle,
  alignItems: 'flex-start',
};
const rowLabelStyle: React.CSSProperties = { width: 130, color: 'var(--lf-text-muted)' };
const rowValueStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  alignItems: 'baseline',
};
const oldStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  textDecoration: 'line-through',
};
const arrowStyle: React.CSSProperties = { color: 'var(--lf-text-faint)' };
const newStyle: React.CSSProperties = { color: 'var(--lf-text)', fontWeight: 600 };
const reviewDetailStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.3,
};
const reviewActionButtonStyle: React.CSSProperties = {
  padding: '3px 7px',
  borderRadius: 3,
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 6,
  marginTop: 4,
};
const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--lf-accent)',
  color: 'var(--lf-on-fill)',
  border: 'none',
  padding: '4px 10px',
  borderRadius: 3,
  cursor: 'pointer',
};
