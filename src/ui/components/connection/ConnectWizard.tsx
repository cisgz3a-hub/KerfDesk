import React from 'react';
import { FalconWiFiConnectBlock } from '../falcon-wifi';

interface ConnectWizardProps {
  webSerialSupported: boolean;
  onConnectUsb: () => void;
  onConnectSimulator: () => void;
}

const font = "'DM Sans', system-ui, sans-serif";

export function ConnectWizard({
  webSerialSupported,
  onConnectUsb,
  onConnectSimulator,
}: ConnectWizardProps) {
  return React.createElement('div', {
    style: {
      padding: '30px 20px', display: 'flex', flexDirection: 'column' as const, gap: 10, alignItems: 'center', flex: 1,
      justifyContent: 'center', minHeight: 0,
    },
  },
    React.createElement('div', { style: { fontSize: 36, marginBottom: 8 } }, '⚡'),
    React.createElement('div', { style: { fontSize: 14, color: '#8888aa', marginBottom: 16 } }, 'Connect your laser to get started'),
    webSerialSupported && React.createElement('button', {
      type: 'button',
      onClick: () => { onConnectUsb(); },
      style: {
        width: '100%', maxWidth: 280, padding: '14px', fontSize: 13, fontWeight: 600,
        borderRadius: 10, cursor: 'pointer', fontFamily: font,
        background: 'rgba(0,212,255,0.08)', border: '1px solid #00d4ff', color: '#00d4ff',
      },
    }, '🔌 Connect via USB'),
    !webSerialSupported && React.createElement('div', {
      style: {
        width: '100%', maxWidth: 280, padding: '10px 12px',
        background: '#0a0a14', border: '1px solid #252540',
        borderRadius: 8, fontSize: 11, color: '#8888aa', lineHeight: 1.4,
      },
    }, 'USB connect requires a Chromium browser with Web Serial support. If this button is missing in browser dev mode, run in Electron or Chrome.'),
    // Falcon WiFi UI hidden 2026-04-20 — WiFi integration paused indefinitely, Falcon now supported via USB/GRBL. Code preserved in src/ui/components/falcon-wifi/ for future use.
    // React.createElement(FalconWiFiConnectBlock, {
    //   onActivated: onFalconWifiActivated,
    // }),
    React.createElement('button', {
      type: 'button',
      onClick: () => { onConnectSimulator(); },
      style: {
        width: '100%', maxWidth: 280, padding: '12px', fontSize: 12,
        borderRadius: 10, cursor: 'pointer', fontFamily: font,
        background: '#0a0a14', border: '1px solid #252540', color: '#555570',
      },
    }, '🖥 Use Simulator'),
  );
}
