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
import { ScanningOffsetDialog } from './ScanningOffsetDialog';
import { type ScanningOffsetTable } from '../../core/plan/ScanningOffset';
import { GcodeTemplateEditor } from './GcodeTemplateEditor';
import {
  BUILT_IN_FOOTER_TEMPLATES,
  BUILT_IN_HEADER_TEMPLATES,
  DEFAULT_FOOTER_TEMPLATE_NAME,
  DEFAULT_HEADER_TEMPLATE_NAME,
} from '../../core/plan/GcodeTemplates';

interface DeviceProfileSelectorProps {
  scene: Scene;
  onSceneCommit: (scene: Scene) => void;
  onMessage: (msg: string) => void;
  showConfirm: (title: string, message: string, details?: string) => Promise<boolean>;
  showPrompt: (title: string, message: string, defaultValue?: string) => Promise<string | null>;
}

/** Preserve profile-only fields when overwriting from scene (Update current). */
function mergeProfilePreservedFields(target: DeviceProfile, previous: DeviceProfile): void {
  target.scanningOffsets = previous.scanningOffsets;
  target.maxAccelMmPerS2 = previous.maxAccelMmPerS2;
  target.accelAwarePower = previous.accelAwarePower;
  target.minPowerRatioAccel = previous.minPowerRatioAccel;
  target.smartOverscanEnabled = previous.smartOverscanEnabled;
  target.overscanMm = previous.overscanMm;
  target.preferredPort = previous.preferredPort;
  target.startGcode = previous.startGcode;
  target.endGcode = previous.endGcode;
  target.gcodeHeaderTemplate = previous.gcodeHeaderTemplate;
  target.gcodeFooterTemplate = previous.gcodeFooterTemplate;
}

export function DeviceProfileSelector({ scene, onSceneCommit, onMessage, showConfirm, showPrompt }: DeviceProfileSelectorProps) {
  const [profiles, setProfiles] = useState<DeviceProfile[]>(getDeviceProfiles);
  const [activeId, setActiveId] = useState<string | null>(getActiveProfileId);
  const [scanOffsetOpen, setScanOffsetOpen] = useState(false);
  const [gcodeTemplateOpen, setGcodeTemplateOpen] = useState(false);
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
                  updated.returnToOrigin = active.returnToOrigin ?? true;
                  mergeProfilePreservedFields(updated, active);
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
          React.createElement('option', { value: '__save__', disabled: !activeId }, '↻ Update current'),
          React.createElement('option', { value: '__new__' }, '+ Save new profile'),
        ),
        activeId &&
          React.createElement(
            'button',
            {
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
              style: {
                background: 'none',
                border: 'none',
                color: '#555570',
                fontSize: 14,
                cursor: 'pointer',
                padding: '0 4px',
              },
            },
            '×',
          ),
      ),
      activeId &&
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => setScanOffsetOpen(true),
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
          'Calibrate scanning offsets…',
        ),
      activeId &&
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => setGcodeTemplateOpen(true),
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
          'Edit G-code header/footer…',
        ),
    ),
    React.createElement(ScanningOffsetDialog, {
      open: scanOffsetOpen,
      onClose: () => setScanOffsetOpen(false),
      currentTable: getActiveProfile()?.scanningOffsets ?? [],
      onSave: (table: ScanningOffsetTable) => {
        const active = getActiveProfile();
        if (!active) return;
        const updated: DeviceProfile = {
          ...active,
          scanningOffsets: table.length > 0 ? table : undefined,
        };
        saveDeviceProfile(updated);
        setProfiles(getDeviceProfiles());
        onMessage('✓ Scanning offsets saved to profile');
      },
    }),
    React.createElement(GcodeTemplateEditor, {
      open: gcodeTemplateOpen,
      onClose: () => setGcodeTemplateOpen(false),
      initialHeader:
        getActiveProfile()?.gcodeHeaderTemplate
        ?? BUILT_IN_HEADER_TEMPLATES[DEFAULT_HEADER_TEMPLATE_NAME],
      initialFooter:
        getActiveProfile()?.gcodeFooterTemplate
        ?? BUILT_IN_FOOTER_TEMPLATES[DEFAULT_FOOTER_TEMPLATE_NAME],
      onSave: (header: string, footer: string) => {
        const active = getActiveProfile();
        if (!active) return;
        const updated: DeviceProfile = {
          ...active,
          gcodeHeaderTemplate: header,
          gcodeFooterTemplate: footer,
        };
        saveDeviceProfile(updated);
        setProfiles(getDeviceProfiles());
        onMessage('✓ G-code header/footer templates saved to profile');
      },
    }),
  );
}
