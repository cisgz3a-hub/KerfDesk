import React, { useState } from 'react';
import {
  getDeviceProfiles,
  getActiveProfileId,
  setActiveProfileId,
  applyProfileToScene,
  type DeviceProfile,
} from '../../core/devices/DeviceProfile';
import { type Scene } from '../../core/scene/Scene';
import { type SettingsTab } from './SettingsModal';

interface DeviceProfileSelectorProps {
  scene: Scene;
  onSceneCommit: (scene: Scene) => void;
  onMessage: (msg: string) => void;
  onOpenSettings?: (tab?: SettingsTab) => void;
}

export function DeviceProfileSelector({ scene, onSceneCommit, onMessage, onOpenSettings }: DeviceProfileSelectorProps) {
  const [profiles, setProfiles] = useState<DeviceProfile[]>(getDeviceProfiles);
  const [activeId, setActiveId] = useState<string | null>(getActiveProfileId);
  const font = "'DM Sans', system-ui, sans-serif";

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'div',
      {
        style: {
          padding: '8px 18px',
          borderBottom: '1px solid #1a1a2e',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        },
      },
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 6, alignItems: 'center' } },
        React.createElement(
          'select',
          {
            value: activeId || '',
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
              const id = e.target.value;
              if (id) {
                setActiveProfileId(id);
                setActiveId(id);
                const profile = getDeviceProfiles().find(p => p.id === id);
                if (profile) {
                  const newScene = applyProfileToScene(profile, scene);
                  onSceneCommit(newScene);
                  onMessage(`✓ Switched to "${profile.name}"`);
                }
              } else {
                setActiveProfileId(null);
                setActiveId(null);
              }
              setProfiles(getDeviceProfiles());
            },
            style: {
              flex: 1,
              padding: '4px 8px',
              fontSize: 10,
              background: '#0a0a14',
              border: '1px solid #252540',
              borderRadius: 4,
              color: '#e0e0ec',
              fontFamily: font,
              outline: 'none',
            },
          },
          React.createElement('option', { value: '' }, 'No device profile'),
          ...profiles.map(p =>
            React.createElement('option', { key: p.id, value: p.id }, `${p.name} (${p.machineType} ${p.watts}W)`),
          ),
        ),
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => onOpenSettings?.('profiles'),
          style: {
            alignSelf: 'flex-start',
            padding: '4px 10px',
            fontSize: 10,
            background: '#12121f',
            border: '1px solid #252540',
            borderRadius: 4,
            color: '#a8a8c0',
            fontFamily: font,
            cursor: 'pointer',
          },
        },
        'Open full settings…',
      ),
    ),
  );
}
