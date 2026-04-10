import React, { useState } from 'react';
import {
  getDeviceProfiles,
  saveDeviceProfile,
  deleteDeviceProfile,
  getActiveProfileId,
  setActiveProfileId,
  getActiveProfile,
  profileFromScene,
  applyProfileToScene,
  type DeviceProfile,
} from '../../core/devices/DeviceProfile';
import { type Scene } from '../../core/scene/Scene';

interface DeviceProfileSelectorProps {
  scene: Scene;
  onSceneCommit: (scene: Scene) => void;
  onMessage: (msg: string) => void;
  showConfirm: (title: string, message: string, details?: string) => Promise<boolean>;
  showPrompt: (title: string, message: string, defaultValue?: string) => Promise<string | null>;
}

export function DeviceProfileSelector({ scene, onSceneCommit, onMessage, showConfirm, showPrompt }: DeviceProfileSelectorProps) {
  const [profiles, setProfiles] = useState<DeviceProfile[]>(getDeviceProfiles);
  const [activeId, setActiveId] = useState<string | null>(getActiveProfileId);
  const font = "'DM Sans', system-ui, sans-serif";

  return React.createElement('div', {
    style: { padding: '8px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', gap: 6, alignItems: 'center' },
  },
    React.createElement('select', {
      value: activeId || '',
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value;
        if (id === '__new__') {
          void (async () => {
            const name = await showPrompt('New Profile', 'Enter a name for this device profile:', '');
            if (!name?.trim()) return;
            const profile = profileFromScene(name.trim(), scene);
            saveDeviceProfile(profile);
            setActiveProfileId(profile.id);
            setActiveId(profile.id);
            setProfiles(getDeviceProfiles());
            onMessage(`✓ Profile "${name.trim()}" saved`);
          })();
          return;
        }
        if (id === '__save__') {
          const active = getActiveProfile();
          if (active) {
            const updated = profileFromScene(active.name, scene);
            updated.id = active.id;
            updated.createdAt = active.createdAt;
            saveDeviceProfile(updated);
            setProfiles(getDeviceProfiles());
            onMessage(`✓ Profile "${active.name}" updated`);
          }
          return;
        }
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
      },
      style: {
        flex: 1, padding: '4px 8px', fontSize: 10,
        background: '#0a0a14', border: '1px solid #252540', borderRadius: 4,
        color: '#e0e0ec', fontFamily: font, outline: 'none',
      },
    },
      React.createElement('option', { value: '' }, 'No device profile'),
      ...profiles.map(p =>
        React.createElement('option', { key: p.id, value: p.id }, `${p.name} (${p.machineType} ${p.watts}W)`),
      ),
      React.createElement('option', { value: '__save__', disabled: !activeId }, '↻ Update current'),
      React.createElement('option', { value: '__new__' }, '+ Save new profile'),
    ),
    activeId && React.createElement('button', {
      onClick: async () => {
        const profile = profiles.find(p => p.id === activeId);
        if (!profile) return;
        const ok = await showConfirm(
          'Delete Profile',
          `Delete "${profile.name}"? This cannot be undone.`,
        );
        if (!ok) return;
        deleteDeviceProfile(activeId);
        setActiveProfileId(null);
        setActiveId(null);
        setProfiles(getDeviceProfiles());
        onMessage(`Deleted "${profile.name}"`);
      },
      style: { background: 'none', border: 'none', color: '#555570', fontSize: 14, cursor: 'pointer', padding: '0 4px' },
    }, '×'),
  );
}
