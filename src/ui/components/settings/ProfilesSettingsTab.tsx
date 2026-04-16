/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import React from 'react';
import type { DeviceProfile } from '../../../core/devices/DeviceProfile';

export interface ProfilesSettingsTabProps {
  profiles: DeviceProfile[];
  activeProfileId: string | null;
  onSetActiveProfile: (id: string | null) => void;
  onCreateProfileFromCurrentScene: (name: string) => void;
  onUpdateCurrentFromScene: () => void;
  onDeleteProfile: (id: string) => void;
}

export function ProfilesSettingsTab(props: ProfilesSettingsTabProps) {
  const {
    profiles,
    activeProfileId,
    onSetActiveProfile,
    onCreateProfileFromCurrentScene,
    onUpdateCurrentFromScene,
    onDeleteProfile,
  } = props;
  const [newName, setNewName] = React.useState('');

  return React.createElement('div', null,
    React.createElement('h3', { style: { marginTop: 0, fontSize: 15 } }, 'Device Profiles'),
    React.createElement('p', { style: { fontSize: 11, color: '#888', lineHeight: 1.5 } },
      'Profiles store machine-specific defaults (bed, spindle, acceleration, templates, calibration).',
    ),

    React.createElement('div', { style: { marginBottom: 12 } },
      React.createElement('label', { style: { fontSize: 12, color: '#c0c0d0', display: 'block', marginBottom: 6 } }, 'Active profile'),
      React.createElement('select', {
        value: activeProfileId ?? '',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onSetActiveProfile(e.target.value || null),
        style: {
          width: 360, maxWidth: '100%', padding: '6px 10px',
          background: '#0a0a14', border: '1px solid #252540', borderRadius: 4,
          color: '#e0e0ec', fontSize: 12,
        },
      },
        React.createElement('option', { value: '' }, 'No active profile'),
        ...profiles.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name)),
      ),
    ),

    React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 18 } },
      React.createElement('button', {
        onClick: onUpdateCurrentFromScene,
        disabled: !activeProfileId,
        style: {
          padding: '7px 12px', borderRadius: 4, border: '1px solid #252540',
          background: '#12121f', color: '#a8a8c0', fontSize: 12,
          cursor: activeProfileId ? 'pointer' : 'default', opacity: activeProfileId ? 1 : 0.45,
        },
      }, 'Update current from scene'),
    ),

    React.createElement('div', {
      style: {
        display: 'flex', gap: 8, alignItems: 'center',
        marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #252540',
      },
    },
      React.createElement('input', {
        value: newName,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value),
        placeholder: 'New profile name',
        style: {
          width: 280, maxWidth: '100%', padding: '6px 10px',
          background: '#0a0a14', border: '1px solid #252540', borderRadius: 4,
          color: '#e0e0ec', fontSize: 12,
        },
      }),
      React.createElement('button', {
        onClick: () => {
          if (!newName.trim()) return;
          onCreateProfileFromCurrentScene(newName.trim());
          setNewName('');
        },
        style: {
          padding: '7px 12px', borderRadius: 4, border: 'none',
          background: 'rgb(0,212,255)', color: '#0a0a14', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        },
      }, 'Save new profile'),
    ),

    React.createElement('div', null,
      ...profiles.map(p =>
        React.createElement('div', {
          key: p.id,
          style: {
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 10px', borderBottom: '1px solid #1a1a2e',
            background: p.id === activeProfileId ? '#15152a' : 'transparent',
          },
        },
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 12, color: '#e0e0ec' } }, p.name),
            React.createElement('div', { style: { fontSize: 10, color: '#777' } },
              `${p.machineType} · ${p.bedWidth}x${p.bedHeight} · S${p.maxSpindle}`,
            ),
          ),
          React.createElement('button', {
            onClick: () => onDeleteProfile(p.id),
            style: {
              padding: '4px 8px', borderRadius: 4, border: '1px solid #333355',
              background: 'transparent', color: '#ff6b6b', fontSize: 11, cursor: 'pointer',
            },
          }, 'Delete'),
        ),
      ),
    ),
  );
}
