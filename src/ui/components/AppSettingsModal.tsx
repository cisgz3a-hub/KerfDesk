import React from 'react';
import { type DeviceProfile } from '../../core/devices/DeviceProfile';
import { entitlementService, tierDisplayName } from '../../entitlements';
import { SettingsModal, type SettingsTab } from './SettingsModal';
import {
  MachineSettingsTab,
  type MachineSettingsLiveCapabilities,
} from './settings/MachineSettingsTab';
import { GcodeSettingsTab } from './settings/GcodeSettingsTab';
import { CalibrationSettingsTab } from './settings/CalibrationSettingsTab';
import { ProfilesSettingsTab } from './settings/ProfilesSettingsTab';
import { type UserMode } from '../../app/UserModeGates';
import { exportRuntimeSupportBundle } from '../../diagnostics/SupportBundleExport';

export interface AppSettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  activeProfile: DeviceProfile | null;
  onUpdateProfile: (updates: Partial<DeviceProfile>) => void;
  canAutoDetect: boolean;
  liveCapabilities?: MachineSettingsLiveCapabilities | null;
  onAutoDetect: () => void;
  onReRunSetup: () => void;
  profiles: DeviceProfile[];
  activeProfileId: string | null;
  onSetActiveProfile: (id: string | null) => void;
  onCreateProfileFromCurrentScene: (name: string) => void;
  onUpdateCurrentFromScene: () => void;
  onDeleteProfile: (id: string) => void;
  onShowFontCredits: () => void;
  userMode: UserMode;
  onSetUserMode: (mode: UserMode) => void;
}

export function AppSettingsModal(props: AppSettingsModalProps): React.ReactElement {
  const [supportBundleState, setSupportBundleState] =
    React.useState<'idle' | 'exporting' | 'saved' | 'failed'>('idle');
  const [supportBundleMessage, setSupportBundleMessage] = React.useState<string | null>(null);

  const handleExportSupportBundle = (): void => {
    setSupportBundleState('exporting');
    setSupportBundleMessage(null);
    void exportRuntimeSupportBundle({ machineProfile: props.activeProfile }).then(
      (result) => {
        if (result.ok) {
          setSupportBundleState('saved');
          setSupportBundleMessage(`Support bundle saved: ${result.filename}`);
          return;
        }
        setSupportBundleState('failed');
        setSupportBundleMessage(
          result.reason === 'cancelled'
            ? 'Support bundle export cancelled.'
            : `Support bundle export failed: ${result.message}`,
        );
      },
      (err: unknown) => {
        setSupportBundleState('failed');
        setSupportBundleMessage(
          `Support bundle export failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );
  };

  const modeButton = (mode: UserMode, label: string) => React.createElement('button', {
    type: 'button',
    onClick: () => props.onSetUserMode(mode),
    style: {
      borderRadius: 6,
      border: props.userMode === mode ? '1px solid #00d4ff' : '1px solid #252540',
      background: props.userMode === mode ? 'rgba(0,212,255,0.12)' : '#0f1020',
      color: props.userMode === mode ? '#00d4ff' : '#c0c0d0',
      padding: '8px 12px',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 700,
      fontFamily: "'DM Sans', system-ui, sans-serif",
    },
  }, label);

  return React.createElement(SettingsModal, {
    open: props.open,
    onClose: props.onClose,
    initialTab: props.initialTab,
    machineTab: React.createElement(MachineSettingsTab, {
      activeProfile: props.activeProfile,
      onUpdateProfile: props.onUpdateProfile,
      canAutoDetect: props.canAutoDetect,
      liveCapabilities: props.liveCapabilities,
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
      React.createElement('div', { style: { margin: '0 0 18px' } },
        React.createElement('div', {
          style: { fontSize: 12, color: '#8888aa', marginBottom: 8, fontWeight: 700 },
        }, 'Operator mode'),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          modeButton('beginner', 'Beginner'),
          modeButton('advanced', 'Advanced'),
        ),
      ),
      React.createElement('p', { style: { fontSize: 12, color: '#c0c0d0', lineHeight: 1.6 } },
        'Version: v0.1.0', React.createElement('br'),
        `License: ${tierDisplayName(entitlementService.getState().tier)}`,
      ),
      React.createElement('div', {
        style: {
          marginTop: 18,
          padding: 14,
          border: '1px solid rgba(0,212,255,0.18)',
          borderRadius: 6,
          background: 'rgba(0,212,255,0.05)',
        },
      },
        React.createElement('h4', { style: { margin: '0 0 8px', fontSize: 13 } }, 'Diagnostics'),
        React.createElement('p', {
          style: { margin: '0 0 12px', color: '#aeb7d8', fontSize: 12, lineHeight: 1.5 },
        },
        'Export recent job logs, machine events, storage health, and app details for support.'),
        React.createElement('button', {
          type: 'button',
          onClick: handleExportSupportBundle,
          disabled: supportBundleState === 'exporting',
          style: {
            background: supportBundleState === 'exporting'
              ? 'rgba(80,80,110,0.35)'
              : 'rgba(0,212,255,0.12)',
            border: '1px solid rgba(0,212,255,0.35)',
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: 12,
            color: supportBundleState === 'exporting' ? '#8888aa' : '#00d4ff',
            cursor: supportBundleState === 'exporting' ? 'default' : 'pointer',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontWeight: 700,
          },
        }, supportBundleState === 'exporting' ? 'Exporting...' : 'Export Diagnostic Bundle'),
        supportBundleMessage && React.createElement('div', {
          role: 'status',
          style: {
            marginTop: 10,
            fontSize: 11,
            color: supportBundleState === 'failed' ? '#ff6b88' : '#2dd4a0',
            lineHeight: 1.4,
          },
        }, supportBundleMessage),
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
