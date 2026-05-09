import React, { useMemo, useState } from 'react';
import {
  browserLabel,
  detectBrowserCompatibility,
  markConnectBrowserGuidanceAcknowledged,
  shouldShowConnectBrowserGuidance,
  type BrowserCompatibility,
} from '../../browser/BrowserCompatibility';

interface ConnectWizardProps {
  webSerialSupported: boolean;
  onConnectUsb: () => void;
  onConnectSimulator: () => void;
  onCancelConnect?: () => void;
  browserCompatibility?: BrowserCompatibility;
  /**
   * T1-50 Part A: while true, machine-choice buttons are disabled so a rapid
   * double-click cannot start a second concurrent connect.
   */
  connecting?: boolean;
}

const font = "'DM Sans', system-ui, sans-serif";

const choiceButtonBase: React.CSSProperties = {
  width: '100%',
  padding: '14px 14px',
  borderRadius: 8,
  cursor: 'pointer',
  fontFamily: font,
  textAlign: 'left',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

export function ConnectWizard({
  webSerialSupported,
  onConnectUsb,
  onConnectSimulator,
  onCancelConnect,
  browserCompatibility,
  connecting = false,
}: ConnectWizardProps) {
  const compatibility = useMemo(
    () => browserCompatibility ?? detectBrowserCompatibility({ hasWebSerial: webSerialSupported }),
    [browserCompatibility, webSerialSupported],
  );
  const [showBrowserGuidance, setShowBrowserGuidance] = useState(() => shouldShowConnectBrowserGuidance());
  const dismissBrowserGuidance = () => {
    markConnectBrowserGuidanceAcknowledged();
    setShowBrowserGuidance(false);
  };

  return React.createElement('div', {
    style: {
      padding: '24px 18px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 14,
      flex: 1,
      justifyContent: 'center',
      minHeight: 0,
    },
  },
    React.createElement('div', { style: { textAlign: 'center' as const } },
      React.createElement('div', { style: { fontSize: 28, marginBottom: 8 } }, '⚡'),
      React.createElement('div', {
        style: { fontSize: 15, color: '#e0e0ec', fontWeight: 700 },
      }, 'Choose a machine'),
      React.createElement('div', {
        style: { fontSize: 11, color: '#8888aa', marginTop: 4, lineHeight: 1.4 },
      }, 'Connect a USB laser or practice safely in the simulator.'),
    ),
    !webSerialSupported && React.createElement('div', {
      'data-testid': 'connect-browser-warning',
      style: {
        width: '100%',
        padding: '12px',
        background: 'rgba(255, 212, 68, 0.08)',
        border: '1px solid rgba(255, 212, 68, 0.35)',
        borderRadius: 8,
        fontSize: 11,
        color: '#d8c984',
        lineHeight: 1.45,
      },
    },
      React.createElement('div', {
        style: { color: '#ffd444', fontSize: 12, fontWeight: 800, marginBottom: 5 },
      }, 'Browser check'),
      React.createElement('div', null, `You're using ${browserLabel(compatibility)}.`),
      React.createElement('div', { style: { marginTop: 5 } },
        'USB laser connection needs Web Serial. Use Chrome, Edge, Opera, or the packaged LaserForge app for a real machine.',
      ),
      React.createElement('div', { style: { marginTop: 5, color: '#aaa06b' } },
        'You can continue here in simulator mode to explore safely.',
      ),
    ),
    webSerialSupported && showBrowserGuidance && React.createElement('div', {
      'data-testid': 'connect-browser-guidance',
      style: {
        width: '100%',
        padding: '12px',
        background: 'rgba(0, 212, 255, 0.07)',
        border: '1px solid rgba(0, 212, 255, 0.24)',
        borderRadius: 8,
        fontSize: 11,
        color: '#a9dceb',
        lineHeight: 1.45,
      },
    },
      React.createElement('div', {
        style: { color: '#00d4ff', fontSize: 12, fontWeight: 800, marginBottom: 5 },
      }, 'Connecting your laser'),
      React.createElement('ol', {
        style: { margin: 0, paddingLeft: 18 },
      },
        React.createElement('li', null, 'Connect the USB cable and power on the machine.'),
        React.createElement('li', null, 'Close other laser or CNC software using the serial port.'),
        React.createElement('li', null, 'Click USB laser and choose the laser port in the browser permission popup.'),
      ),
      React.createElement('button', {
        type: 'button',
        onClick: dismissBrowserGuidance,
        style: {
          marginTop: 8,
          padding: '5px 9px',
          borderRadius: 6,
          border: '1px solid rgba(0, 212, 255, 0.35)',
          background: 'rgba(0, 212, 255, 0.08)',
          color: '#88e9ff',
          fontFamily: font,
          fontSize: 10,
          cursor: 'pointer',
        },
      }, 'Got it'),
    ),
    webSerialSupported && React.createElement('button', {
      type: 'button',
      onClick: () => { if (!connecting) onConnectUsb(); },
      disabled: connecting,
      title: connecting ? 'Connecting...' : 'Connect to your laser over USB',
      style: {
        ...choiceButtonBase,
        background: 'rgba(0,212,255,0.1)',
        border: '1px solid #00d4ff',
        color: '#00d4ff',
        opacity: connecting ? 0.5 : 1,
        cursor: connecting ? 'wait' : 'pointer',
      },
    },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 800 } },
        connecting ? 'Connecting...' : 'USB laser',
      ),
      !connecting && React.createElement('span', {
        style: { fontSize: 10, color: '#88e9ff', lineHeight: 1.35 },
      }, 'Use the real machine through Web Serial.'),
    ),
    connecting && onCancelConnect && React.createElement('button', {
      type: 'button',
      onClick: onCancelConnect,
      style: {
        width: '100%',
        padding: '10px',
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 8,
        cursor: 'pointer',
        fontFamily: font,
        background: 'rgba(255,68,102,0.08)',
        border: '1px solid rgba(255,68,102,0.8)',
        color: '#ff6685',
      },
    }, 'Cancel connect'),
    React.createElement('button', {
      type: 'button',
      onClick: () => { if (!connecting) onConnectSimulator(); },
      disabled: connecting,
      title: connecting ? 'Connecting...' : 'Open the simulator',
      style: {
        ...choiceButtonBase,
        background: '#0a0a14',
        border: '1px solid #252540',
        color: '#c0c0d0',
        opacity: connecting ? 0.5 : 1,
        cursor: connecting ? 'wait' : 'pointer',
      },
    },
      React.createElement('span', { style: { fontSize: 13, fontWeight: 800 } },
        connecting ? 'Connecting...' : 'Simulator',
      ),
      !connecting && React.createElement('span', {
        style: { fontSize: 10, color: '#777798', lineHeight: 1.35 },
      }, 'Try movement, framing, and job controls without hardware.'),
    ),
  );
}
