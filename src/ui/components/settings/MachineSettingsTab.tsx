/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import React from 'react';
import type { DeviceProfile } from '../../../core/devices/DeviceProfile';

export interface MachineSettingsTabProps {
  activeProfile: DeviceProfile | null;
  onUpdateProfile: (updates: Partial<DeviceProfile>) => void;
  canAutoDetect: boolean;
  onAutoDetect: () => void;
  autoDetecting?: boolean;
  /** Opens the welcome / setup wizard (e.g. re-run initial machine questions). */
  onReRunSetup?: () => void;
}

export function MachineSettingsTab(props: MachineSettingsTabProps) {
  const { activeProfile, onUpdateProfile, canAutoDetect, onAutoDetect, autoDetecting, onReRunSetup } = props;

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
        'Machine is connected. Pull bed size, max rates, and acceleration from live GRBL settings.'),
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

    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: sectionTitleStyle }, 'Bed dimensions'),
      numberField('Bed width', 'bedWidth', 1, 'mm', 'GRBL $130'),
      numberField('Bed height', 'bedHeight', 1, 'mm', 'GRBL $131'),
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
      numberField('Max feed rate (legacy)', 'maxFeedRate', 100, 'mm/min',
        'Fallback rapid speed ceiling'),
    ),

    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: sectionTitleStyle }, 'Behavior'),
      checkboxField('Homing enabled', 'homingEnabled',
        'If on, preflight warns when header lacks $H. Matches GRBL $22.'),
      checkboxField('Acceleration-aware power (default)', 'accelAwarePower',
        'Default for new image layers. Per-layer override available.'),
      checkboxField('Smart overscan sizing (default)', 'smartOverscanEnabled',
        'Compute overscan from speed + acceleration. Per-layer override.'),
      checkboxField('Skip WCS normalization prompt on connect', 'suppressWcsConsent',
        'If checked, LaserForge will silently set G54 to (0,0,0) and $10=0 on each connect for this machine, without asking.'),
    ),
  );
}
