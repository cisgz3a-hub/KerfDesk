/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import React from 'react';
import type { DeviceProfile, MachineOriginCorner } from '../../../core/devices/DeviceProfile';
import {
  confidenceLabel,
  resolveCapabilityValue,
  type CapabilityValue,
} from '../../../controllers/CapabilityValue';

export interface MachineSettingsLiveCapabilities {
  bedWidth?: number | null;
  bedHeight?: number | null;
  maxSpindle?: number | null;
  laserMode?: boolean | null;
  homingEnabled?: boolean | null;
}

interface MachineCapabilityRow {
  id: string;
  label: string;
  valueText: string;
  chipText: string;
  confidence: CapabilityValue<unknown>['confidence'];
  detail: string;
}

export interface MachineSettingsTabProps {
  activeProfile: DeviceProfile | null;
  onUpdateProfile: (updates: Partial<DeviceProfile>) => void;
  canAutoDetect: boolean;
  onAutoDetect: () => void;
  autoDetecting?: boolean;
  liveCapabilities?: MachineSettingsLiveCapabilities | null;
  /** Opens the welcome / setup wizard (e.g. re-run initial machine questions). */
  onReRunSetup?: () => void;
}

function finitePositive(v: number | null | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function chipText(v: CapabilityValue<unknown>): string {
  if (v.confidence === 'manual') return 'Profile only';
  return confidenceLabel(v.confidence);
}

function detailText(v: CapabilityValue<unknown>, grblSetting: string): string {
  switch (v.confidence) {
    case 'verified':
      return `Verified from GRBL ${grblSetting}`;
    case 'manual':
      return 'Connect to verify live controller settings';
    case 'fallback':
      return 'Default value';
    case 'unknown':
      return 'Settings not read yet';
  }
}

function rowFromCapability<T>(args: {
  id: string;
  label: string;
  value: CapabilityValue<T>;
  grblSetting: string;
  format: (value: T) => string;
}): MachineCapabilityRow {
  return {
    id: args.id,
    label: args.label,
    valueText: args.value.value == null ? 'Unknown' : args.format(args.value.value),
    chipText: chipText(args.value as CapabilityValue<unknown>),
    confidence: args.value.confidence,
    detail: detailText(args.value as CapabilityValue<unknown>, args.grblSetting),
  };
}

function boolLabel(value: boolean): string {
  return value ? 'Enabled' : 'Disabled';
}

export function buildMachineSettingsCapabilityRows(
  profile: DeviceProfile,
  liveCapabilities: MachineSettingsLiveCapabilities | null | undefined,
  now = Date.now(),
): MachineCapabilityRow[] {
  // T3-58: UI confidence is resolved from live firmware first, then saved
  // profile. This keeps the visible settings honest: verified values are
  // labelled as such, profile-only values ask the user to connect, and values
  // with no profile source stay unknown.
  const bedWidth = resolveCapabilityValue({
    firmware: finitePositive(liveCapabilities?.bedWidth),
    profile: finitePositive(profile.bedWidth),
    now,
  });
  const bedHeight = resolveCapabilityValue({
    firmware: finitePositive(liveCapabilities?.bedHeight),
    profile: finitePositive(profile.bedHeight),
    now,
  });
  const maxSpindle = resolveCapabilityValue({
    firmware: finitePositive(liveCapabilities?.maxSpindle),
    profile: finitePositive(profile.maxSpindle),
    now,
  });
  const laserMode = resolveCapabilityValue<boolean>({
    firmware: liveCapabilities?.laserMode ?? undefined,
    now,
  });
  const homingEnabled = resolveCapabilityValue({
    firmware: liveCapabilities?.homingEnabled ?? undefined,
    profile: profile.homingEnabled,
    now,
  });

  return [
    rowFromCapability({
      id: 'bed-width',
      label: 'Bed width',
      value: bedWidth,
      grblSetting: '$130/$131',
      format: value => `${value} mm`,
    }),
    rowFromCapability({
      id: 'bed-height',
      label: 'Bed height',
      value: bedHeight,
      grblSetting: '$130/$131',
      format: value => `${value} mm`,
    }),
    rowFromCapability({
      id: 'max-spindle',
      label: 'Max spindle',
      value: maxSpindle,
      grblSetting: '$30',
      format: value => `${value}`,
    }),
    rowFromCapability({
      id: 'laser-mode',
      label: 'Laser mode',
      value: laserMode,
      grblSetting: '$32',
      format: boolLabel,
    }),
    rowFromCapability({
      id: 'homing',
      label: 'Homing',
      value: homingEnabled,
      grblSetting: '$22',
      format: boolLabel,
    }),
  ];
}

export function MachineSettingsTab(props: MachineSettingsTabProps) {
  const {
    activeProfile,
    onUpdateProfile,
    canAutoDetect,
    onAutoDetect,
    autoDetecting,
    liveCapabilities,
    onReRunSetup,
  } = props;

  if (!activeProfile) {
    return React.createElement('div', { style: { color: '#888', fontSize: 13 } },
      'No active device profile. Create or select one in the Profiles tab.');
  }

  const sectionStyle: React.CSSProperties = { marginBottom: 24 };
  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#c0c0d0',
  };
  const fieldRowStyle: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: '180px 140px 1fr',
    gap: 12, alignItems: 'center', marginBottom: 10,
  };
  const labelStyle: React.CSSProperties = { fontSize: 12, color: '#c0c0d0' };
  const inputStyle: React.CSSProperties = {
    padding: '6px 10px', background: '#0a0a14', border: '1px solid #252540',
    borderRadius: 4, color: '#e0e0ec', fontSize: 12, outline: 'none', width: '100%',
  };
  const hintStyle: React.CSSProperties = { fontSize: 10, color: '#666' };
  const stopOnErrorChecked = activeProfile.stopOnError !== false;
  const capabilityRows = buildMachineSettingsCapabilityRows(activeProfile, liveCapabilities);
  const cornerOptions: Array<{ value: MachineOriginCorner; label: string }> = [
    { value: 'front-left', label: 'Front left' },
    { value: 'front-right', label: 'Front right' },
    { value: 'rear-left', label: 'Rear left' },
    { value: 'rear-right', label: 'Rear right' },
  ];

  const rerunSection = onReRunSetup && React.createElement('div', {
    style: {
      marginBottom: 20,
      padding: 12,
      background: '#0a0a14',
      border: '1px solid #252540',
      borderRadius: 8,
    },
  },
    React.createElement('button', {
      type: 'button',
      onClick: onReRunSetup,
      style: {
        padding: '6px 12px',
        background: 'transparent',
        border: '1px solid #3a3a55',
        borderRadius: 6,
        color: '#a0a0c0',
        fontSize: 12,
        cursor: 'pointer',
        fontWeight: 500,
      },
    }, '⚙ Re-run setup wizard'),
    React.createElement('p', {
      style: { fontSize: 10, color: '#555570', marginTop: 10, marginBottom: 0, lineHeight: 1.45 },
    },
      'Reconfigure your machine settings. Your current settings will be preserved unless you change them during setup.',
    ),
  );

  const numberField = (label: string, field: keyof DeviceProfile, step: number, unit: string, hint?: string) => {
    const value = (activeProfile[field] as number | undefined) ?? '';
    return React.createElement('div', { style: fieldRowStyle },
      React.createElement('label', { style: labelStyle }, label),
      React.createElement('input', {
        type: 'number',
        step,
        value,
        style: inputStyle,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value;
          if (raw === '') {
            onUpdateProfile({ [field]: undefined } as unknown as Partial<DeviceProfile>);
          } else {
            const parsed = parseFloat(raw);
            if (Number.isFinite(parsed)) onUpdateProfile({ [field]: parsed } as unknown as Partial<DeviceProfile>);
          }
        },
      }),
      React.createElement('div', { style: hintStyle },
        `${unit}${hint ? ` — ${hint}` : ''}`),
    );
  };

  const checkboxField = (label: string, field: keyof DeviceProfile, hint?: string) => {
    const checked = Boolean(activeProfile[field]);
    return React.createElement('div', { style: fieldRowStyle },
      React.createElement('label', { style: labelStyle }, label),
      React.createElement('input', {
        type: 'checkbox',
        checked,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
          onUpdateProfile({ [field]: e.target.checked } as unknown as Partial<DeviceProfile>);
        },
        style: { justifySelf: 'start' },
      }),
      React.createElement('div', { style: hintStyle }, hint ?? ''),
    );
  };

  const cornerField = (
    label: string,
    field: 'originCorner' | 'homeCorner',
    value: MachineOriginCorner,
    hint: string,
  ) => React.createElement('div', { style: fieldRowStyle },
    React.createElement('label', { style: labelStyle }, label),
    React.createElement('select', {
      value,
      style: inputStyle,
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
        onUpdateProfile({ [field]: e.target.value as MachineOriginCorner } as Partial<DeviceProfile>);
      },
    },
      cornerOptions.map(option => React.createElement('option', { key: option.value, value: option.value },
        option.label,
      )),
    ),
    React.createElement('div', { style: hintStyle }, hint),
  );

  const capabilityChipStyle = (confidence: MachineCapabilityRow['confidence']): React.CSSProperties => {
    const colors = {
      verified: { border: 'rgba(20,210,135,0.45)', bg: 'rgba(20,210,135,0.12)', fg: '#7ef0b6' },
      manual: { border: 'rgba(255,190,70,0.45)', bg: 'rgba(255,190,70,0.12)', fg: '#ffd36a' },
      fallback: { border: 'rgba(255,80,110,0.45)', bg: 'rgba(255,80,110,0.12)', fg: '#ff7890' },
      unknown: { border: 'rgba(150,150,180,0.35)', bg: 'rgba(150,150,180,0.08)', fg: '#aaaac0' },
    }[confidence];
    return {
      display: 'inline-flex',
      justifyContent: 'center',
      minWidth: 78,
      padding: '3px 8px',
      border: `1px solid ${colors.border}`,
      background: colors.bg,
      color: colors.fg,
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 700,
    };
  };

  const capabilitySection = React.createElement('div', {
    style: sectionStyle,
    'data-testid': 'machine-capability-confidence',
  },
    React.createElement('div', { style: sectionTitleStyle }, 'Capability confidence'),
    React.createElement('div', {
      style: {
        display: 'grid',
        gap: 8,
        padding: 10,
        background: '#0a0a14',
        border: '1px solid #252540',
        borderRadius: 6,
      },
    },
      capabilityRows.map(row => React.createElement('div', {
        key: row.id,
        style: {
          display: 'grid',
          gridTemplateColumns: '120px minmax(70px, 1fr) 90px',
          gap: 10,
          alignItems: 'center',
        },
      },
        React.createElement('div', { style: labelStyle }, row.label),
        React.createElement('div', { style: { color: '#e0e0ec', fontSize: 12, fontWeight: 700 } }, row.valueText),
        React.createElement('div', { style: capabilityChipStyle(row.confidence) }, row.chipText),
        React.createElement('div', {
          style: {
            gridColumn: '2 / 4',
            color: '#777792',
            fontSize: 10,
            lineHeight: 1.35,
          },
        }, row.detail),
      )),
    ),
  );

  return React.createElement('div', null,
    rerunSection,
    canAutoDetect && React.createElement('div', {
      style: {
        marginBottom: 20, padding: 12,
        background: '#0f1a2a', border: '1px solid #1a3a4a',
        borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      },
    },
      React.createElement('div', { style: { fontSize: 12 } },
        'Machine is connected. Pull bed size, max spindle, laser mode, homing state, max rates, and acceleration from live GRBL settings.'),
      React.createElement('button', {
        onClick: onAutoDetect,
        disabled: autoDetecting,
        style: {
          padding: '6px 12px', background: 'rgb(0,212,255)', border: 'none',
          borderRadius: 4, color: '#0a0a14', fontSize: 11, fontWeight: 600,
          cursor: autoDetecting ? 'wait' : 'pointer',
          opacity: autoDetecting ? 0.5 : 1,
        },
      }, autoDetecting ? 'Detecting...' : 'Auto-detect from machine'),
    ),

    capabilitySection,

    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: sectionTitleStyle }, 'Bed dimensions'),
      numberField('Bed width', 'bedWidth', 1, 'mm', 'GRBL $130'),
      numberField('Bed height', 'bedHeight', 1, 'mm', 'GRBL $131'),
    ),

    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: sectionTitleStyle }, 'Coordinates'),
      cornerField('Machine zero corner', 'originCorner', activeProfile.originCorner,
        'Where the controller reports X0 Y0. Used for canvas, Frame, Start, and G-code orientation.'),
      cornerField('Home corner', 'homeCorner', activeProfile.homeCorner ?? activeProfile.originCorner,
        'Physical corner the head seeks when Home runs. Does not rewrite GRBL $23.'),
    ),

    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: sectionTitleStyle }, 'Laser'),
      numberField('Max spindle (S)', 'maxSpindle', 1, 'S value', 'GRBL $30, typically 1000'),
    ),

    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: sectionTitleStyle }, 'Motion limits'),
      numberField('Max rate X', 'maxRateX', 100, 'mm/min', 'GRBL $110'),
      numberField('Max rate Y', 'maxRateY', 100, 'mm/min', 'GRBL $111'),
      numberField('Max acceleration X', 'maxAccelX', 50, 'mm/s²', 'GRBL $120'),
      numberField('Max acceleration Y', 'maxAccelY', 50, 'mm/s²', 'GRBL $121'),
      numberField('Max acceleration (fallback)', 'maxAccelMmPerS2', 50, 'mm/s²',
        'Used when X/Y values unknown'),
      numberField('Frame-dot feed rate', 'frameDotFeedRate', 100, 'mm/min',
        'Speed for Frame + Mark Center laser-dot moves'),
      numberField('Max feed rate (legacy)', 'maxFeedRate', 100, 'mm/min',
        'Fallback rapid speed ceiling'),
    ),

    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: sectionTitleStyle }, 'Behavior'),
      checkboxField('Homing enabled', 'homingEnabled',
        'If on, preflight warns when header lacks \u0024H. Matches GRBL \u002422.'),
      checkboxField('Acceleration-aware power (default)', 'accelAwarePower',
        'Default for new image layers. Per-layer override available.'),
      checkboxField('Smart overscan sizing (default)', 'smartOverscanEnabled',
        'Compute overscan from speed + acceleration. Per-layer override.'),
      checkboxField('Skip WCS normalization prompt on connect', 'suppressWcsConsent',
        'If checked, LaserForge will silently set G54 to (0,0,0) and $10=0 on each connect for this machine, without asking.'),
      checkboxField('Allow negative workspace coordinates', 'allowsNegativeWorkspace',
        'Most diode lasers have the origin at a front corner and treat negative coords as limit hits. Enable only if your machine is configured for work offsets that produce negative coordinates.'),
    ),

    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: sectionTitleStyle }, 'Advanced'),
      React.createElement('div', { style: fieldRowStyle },
        React.createElement('label', { style: labelStyle }, 'Stop job on GRBL errors'),
        React.createElement('input', {
          type: 'checkbox',
          checked: stopOnErrorChecked,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            onUpdateProfile({ stopOnError: e.target.checked } as unknown as Partial<DeviceProfile>);
          },
          style: { justifySelf: 'start' },
        }),
        React.createElement('div', { style: hintStyle },
          'When checked, any error:N response from the machine aborts the running job. Uncheck only if your firmware emits benign error codes that are safe to ignore. Uncheck at your own risk — real errors (bad G-code, limit hits) will also be ignored until you turn this back on.',
        ),
      ),
    ),
  );
}
