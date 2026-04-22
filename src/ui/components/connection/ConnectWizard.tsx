import React from 'react';
import { FalconWiFiConnectBlock } from '../falcon-wifi';

interface ConnectWizardProps {
  webSerialSupported: boolean;
  wifiBridgeHost: string;
  setWifiBridgeHost: (host: string) => void;
  wifiBridgePort: string;
  setWifiBridgePort: (port: string) => void;
  onConnectUsb: () => void;
  onConnectWifi: () => void;
  onConnectSimulator: () => void;
}

const font = "'DM Sans', system-ui, sans-serif";
const mono = "'JetBrains Mono', monospace";

export function ConnectWizard({
  webSerialSupported,
  wifiBridgeHost,
  setWifiBridgeHost,
  wifiBridgePort,
  setWifiBridgePort,
  onConnectUsb,
  onConnectWifi,
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
    React.createElement('div', {
      style: {
        width: '100%',
        maxWidth: 280,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 6,
        marginTop: 2,
        marginBottom: 2,
      },
    },
      React.createElement('div', {
        style: { display: 'flex', gap: 6 },
      },
        React.createElement('input', {
          type: 'text',
          value: wifiBridgeHost,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setWifiBridgeHost(e.target.value),
          placeholder: 'Bridge host',
          style: {
            flex: 1,
            padding: '8px 10px',
            fontSize: 11,
            borderRadius: 8,
            fontFamily: mono,
            background: '#0a0a14',
            border: '1px solid #252540',
            color: '#c0c0d0',
            outline: 'none',
          },
        }),
        React.createElement('input', {
          type: 'text',
          value: wifiBridgePort,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setWifiBridgePort(e.target.value),
          placeholder: 'Port',
          style: {
            width: 68,
            padding: '8px 10px',
            fontSize: 11,
            borderRadius: 8,
            fontFamily: mono,
            background: '#0a0a14',
            border: '1px solid #252540',
            color: '#c0c0d0',
            outline: 'none',
          },
        }),
      ),
      React.createElement('button', {
        type: 'button',
        onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          e.stopPropagation();
          onConnectWifi();
        },
        style: {
          width: '100%',
          padding: '12px',
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 10,
          cursor: 'pointer',
          fontFamily: font,
          background: 'rgba(45,212,160,0.08)',
          border: '1px solid rgba(45,212,160,0.7)',
          color: '#2dd4a0',
          position: 'relative' as const,
          zIndex: 2,
        },
      }, '📡 Connect via WiFi'),
    ),
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
