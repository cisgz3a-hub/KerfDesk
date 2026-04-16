/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import React from 'react';

export type SettingsTab = 'machine' | 'gcode' | 'calibration' | 'profiles' | 'about';

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  machineTab: React.ReactNode;
  gcodeTab: React.ReactNode;
  calibrationTab: React.ReactNode;
  profilesTab: React.ReactNode;
  aboutTab: React.ReactNode;
}

export function SettingsModal(props: SettingsModalProps) {
  const { open, onClose, initialTab = 'machine' } = props;
  const [activeTab, setActiveTab] = React.useState<SettingsTab>(initialTab);

  React.useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  if (!open) return null;

  const tabs: { id: SettingsTab; label: string; content: React.ReactNode }[] = [
    { id: 'machine', label: 'Machine', content: props.machineTab },
    { id: 'gcode', label: 'G-code', content: props.gcodeTab },
    { id: 'calibration', label: 'Calibration', content: props.calibrationTab },
    { id: 'profiles', label: 'Profiles', content: props.profilesTab },
    { id: 'about', label: 'About', content: props.aboutTab },
  ];

  const tabButtonStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '10px 16px',
    background: isActive ? '#252540' : 'transparent',
    border: 'none',
    borderLeft: isActive ? '3px solid rgb(0,212,255)' : '3px solid transparent',
    color: isActive ? '#e0e0ec' : '#888',
    fontSize: 13,
    fontWeight: isActive ? 600 : 400,
    textAlign: 'left',
    cursor: 'pointer',
    display: 'block',
    width: '100%',
  });

  return React.createElement('div', {
    style: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    onClick: (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
  },
  React.createElement('div', {
    style: {
      background: '#1a1a2e',
      border: '1px solid #252540',
      borderRadius: 8,
      width: 920,
      height: 640,
      maxWidth: '95vw',
      maxHeight: '90vh',
      color: '#e0e0ec',
      fontFamily: 'system-ui, sans-serif',
      display: 'flex',
      flexDirection: 'column',
    },
  },
  React.createElement('div', {
    style: {
      padding: '16px 24px',
      borderBottom: '1px solid #252540',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
  },
  React.createElement('h2', { style: { margin: 0, fontSize: 16, fontWeight: 600 } }, 'Settings'),
  React.createElement('button', {
    onClick: onClose,
    style: {
      background: 'transparent',
      border: 'none',
      color: '#888',
      fontSize: 20,
      cursor: 'pointer',
      padding: 4,
      lineHeight: 1,
    },
    'aria-label': 'Close settings',
  }, '×'),
  ),
  React.createElement('div', {
    style: { display: 'flex', flex: 1, overflow: 'hidden' },
  },
  React.createElement('div', {
    style: {
      width: 180,
      background: '#15152a',
      borderRight: '1px solid #252540',
      padding: '8px 0',
      overflowY: 'auto',
    },
  },
  ...tabs.map(tab =>
    React.createElement('button', {
      key: tab.id,
      onClick: () => setActiveTab(tab.id),
      style: tabButtonStyle(activeTab === tab.id),
    }, tab.label),
  ),
  ),
  React.createElement('div', {
    style: {
      flex: 1,
      padding: '24px 32px',
      overflowY: 'auto',
    },
  },
  tabs.find(t => t.id === activeTab)?.content ?? null,
  ),
  ),
  ),
  );
}
