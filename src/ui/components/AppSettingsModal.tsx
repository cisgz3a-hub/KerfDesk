import React from 'react';
import { type DeviceProfile } from '../../core/devices/DeviceProfile';
import { entitlementService, tierDisplayName } from '../../entitlements';
import { SettingsModal, type SettingsTab } from './SettingsModal';
import { MachineSettingsTab } from './settings/MachineSettingsTab';
import { GcodeSettingsTab } from './settings/GcodeSettingsTab';
import { CalibrationSettingsTab } from './settings/CalibrationSettingsTab';
import { ProfilesSettingsTab } from './settings/ProfilesSettingsTab';

export interface AppSettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  activeProfile: DeviceProfile | null;
  onUpdateProfile: (updates: Partial<DeviceProfile>) => void;
  canAutoDetect: boolean;
  onAutoDetect: () => void;
  onReRunSetup: () => void;
  profiles: DeviceProfile[];
  activeProfileId: string | null;
  onSetActiveProfile: (id: string | null) => void;
  onCreateProfileFromCurrentScene: (name: string) => void;
  onUpdateCurrentFromScene: () => void;
  onDeleteProfile: (id: string) => void;
  onShowFontCredits: () => void;
}

export function AppSettingsModal(props: AppSettingsModalProps): React.ReactElement {
  return React.createElement(SettingsModal, {
    open: props.open,
    onClose: props.onClose,
    initialTab: props.initialTab,
    machineTab: React.createElement(MachineSettingsTab, {
      activeProfile: props.activeProfile,
      onUpdateProfile: props.onUpdateProfile,
      canAutoDetect: props.canAutoDetect,
      onAutoDetect: props.onAutoDetect,
      autoDetecting: false,
      onReRunSetup: props.onReRunSetup,
    }),
    gcodeTab: React.createElement(GcodeSettingsTab, {
      activeProfile: props.activeProfile,
      onUpdateProfile: props.onUpdateProfile,
    }),
    calibrationTab: React.createElement(CalibrationSettingsTab, {
      activeProfile: props.activeProfile,
      onUpdateProfile: props.onUpdateProfile,
    }),
    profilesTab: React.createElement(ProfilesSettingsTab, {
      profiles: props.profiles,
      activeProfileId: props.activeProfileId,
      onSetActiveProfile: props.onSetActiveProfile,
      onCreateProfileFromCurrentScene: props.onCreateProfileFromCurrentScene,
      onUpdateCurrentFromScene: props.onUpdateCurrentFromScene,
      onDeleteProfile: props.onDeleteProfile,
    }),
    aboutTab: React.createElement('div', null,
      React.createElement('h3', { style: { marginTop: 0 } }, 'LaserForge'),
      React.createElement('p', { style: { fontSize: 12, color: '#c0c0d0', lineHeight: 1.6 } },
        'Version: v0.1.0', React.createElement('br'),
        `License: ${tierDisplayName(entitlementService.getState().tier)}`,
      ),
      React.createElement('p', { style: { fontSize: 11, color: '#888', marginTop: 20 } },
        'Third-party licenses: see LICENSES-THIRD-PARTY.md'),
      React.createElement('p', { style: { marginTop: 12 } },
        React.createElement('button', {
          type: 'button',
          onClick: props.onShowFontCredits,
          style: {
            background: 'rgba(0,212,255,0.08)',
            border: '1px solid rgba(0,212,255,0.25)',
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: 12,
            color: '#00d4ff',
            cursor: 'pointer',
            fontFamily: "'DM Sans', system-ui, sans-serif",
          },
        }, 'Font credits (bundled fonts)')),
    ),
  });
}
