/**
 * "Connect to Falcon WiFi" inline block, shown inside the existing
 * ConnectWizard as a third option alongside USB and the WiFi bridge.
 *
 * Flow:
 *   1. User enters Falcon IP (default 192.168.2.5) and clicks Test.
 *   2. We call falcon-wifi:test-connection. On success we show model +
 *      firmware + laser info and enable the "Use this Falcon" action.
 *   3. On confirm, we persist a DeviceProfile with
 *      connection.kind = 'falcon-wifi' and mark it active. The parent
 *      ConnectionPanel notices the active-profile change and swaps its
 *      content to <FalconWiFiStatusPanel>.
 *
 * This component never touches the GRBL controller — it is completely
 * self-contained and only writes to the device-profile store.
 */

import React, { useCallback, useEffect, useState } from 'react';

import {
  createFalconWiFiProfile,
  getActiveProfile,
  getDeviceProfiles,
  saveDeviceProfile,
  setActiveProfileId,
  type DeviceProfile,
} from '../../../core/devices/DeviceProfile';
import { falconIpc, isFalconWiFiAvailable, type FalconTestConnectionResult } from './falconIpc';

const font = "'DM Sans', system-ui, sans-serif";
const mono = "'JetBrains Mono', monospace";

const IP_STORAGE_KEY = 'laserforge_falcon_last_ip';
const DEFAULT_IP = '192.168.2.5';

interface Props {
  /** Called after the user clicks "Use this Falcon" and the profile is active. */
  onActivated?: (profile: DeviceProfile) => void;
}

function rememberIp(ip: string): void {
  try {
    localStorage.setItem(IP_STORAGE_KEY, ip);
  } catch {
    /* ignore */
  }
}

function recallIp(): string {
  try {
    return localStorage.getItem(IP_STORAGE_KEY) || DEFAULT_IP;
  } catch {
    return DEFAULT_IP;
  }
}

/**
 * Look for an existing profile already configured for this IP, so repeated
 * connects update in place instead of creating duplicates.
 */
function findProfileForIp(ip: string): DeviceProfile | null {
  const profiles = getDeviceProfiles();
  const match = profiles.find(
    (p) => p.connection?.kind === 'falcon-wifi' && p.connection.ip === ip,
  );
  return match ?? null;
}

export function FalconWiFiConnectBlock({ onActivated }: Props): React.ReactElement | null {
  const available = isFalconWiFiAvailable();

  const [ip, setIp] = useState<string>(recallIp());
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<FalconTestConnectionResult | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // If user edits the IP after a previous test, clear stale results.
    setResult(null);
  }, [ip]);

  const handleTest = useCallback(async () => {
    const cleaned = ip.trim();
    if (!cleaned) {
      setResult({ ok: false, error: 'Enter an IP or hostname' });
      return;
    }
    setTesting(true);
    try {
      const res = await falconIpc.testConnection(cleaned);
      setResult(res);
      if (res.ok) rememberIp(cleaned);
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }, [ip]);

  const handleActivate = useCallback(() => {
    if (!result?.ok) return;
    const cleaned = ip.trim();
    const existing = findProfileForIp(cleaned);
    const profileName = result.deviceModel
      ? `${result.deviceModel} (${cleaned})`
      : `Falcon WiFi (${cleaned})`;

    const base: DeviceProfile = existing ?? createFalconWiFiProfile(profileName, cleaned);
    const next: DeviceProfile = {
      ...base,
      name: profileName,
      brand: 'Creality',
      model: result.deviceModel ?? base.model ?? 'Falcon A1 Pro',
      connection: {
        kind: 'falcon-wifi',
        ip: cleaned,
        macAddress: base.connection?.kind === 'falcon-wifi' ? base.connection.macAddress : undefined,
        deviceModel: result.deviceModel,
        firmwareVersion: result.firmwareVersion,
        laserInfo: result.laserInfo,
        serialNumber: result.serialNumber,
      },
    };
    saveDeviceProfile(next);
    setActiveProfileId(next.id);
    try {
      window.dispatchEvent(new Event('laserforge:active-profile-changed'));
    } catch {
      /* non-DOM env */
    }
    onActivated?.(next);
  }, [ip, onActivated, result]);

  if (!available) {
    // Running in a plain browser (no Electron preload) — hide the option
    // rather than offer something we cannot fulfil.
    return null;
  }

  const alreadyActive = (() => {
    const active = getActiveProfile();
    return (
      active?.connection?.kind === 'falcon-wifi' && active.connection.ip === ip.trim()
    );
  })();

  const containerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 280,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 2,
  };

  if (!expanded) {
    return React.createElement(
      'button',
      {
        type: 'button',
        onClick: () => setExpanded(true),
        style: {
          ...containerStyle,
          padding: '12px',
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 10,
          cursor: 'pointer',
          fontFamily: font,
          background: 'rgba(240, 180, 41, 0.08)',
          border: '1px solid rgba(240, 180, 41, 0.7)',
          color: '#f0b429',
        },
      },
      '📶 Falcon WiFi (direct)',
    );
  }

  return React.createElement(
    'div',
    { style: containerStyle },
    React.createElement(
      'div',
      {
        style: {
          fontSize: 11,
          color: '#f0b429',
          fontWeight: 600,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
      },
      React.createElement('span', null, '📶 Falcon A1 Pro (direct WiFi)'),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => setExpanded(false),
          style: {
            background: 'transparent',
            border: 'none',
            color: '#555570',
            fontSize: 14,
            cursor: 'pointer',
          },
          title: 'Hide',
        },
        '×',
      ),
    ),
    React.createElement('input', {
      type: 'text',
      value: ip,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setIp(e.target.value),
      placeholder: 'Falcon IP, e.g. 192.168.2.5',
      autoComplete: 'off',
      spellCheck: false,
      style: {
        width: '100%',
        padding: '8px 10px',
        fontSize: 11,
        borderRadius: 8,
        fontFamily: mono,
        background: '#0a0a14',
        border: '1px solid #252540',
        color: '#c0c0d0',
        outline: 'none',
        boxSizing: 'border-box' as const,
      },
    }),
    React.createElement(
      'div',
      { style: { fontSize: 10, color: '#555570', lineHeight: 1.4 } },
      'Check the Falcon touchscreen ➜ WiFi info for its IP. A DHCP reservation on ' +
        'your router is recommended so it does not change.',
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 6 } },
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            void handleTest();
          },
          disabled: testing || !ip.trim(),
          style: {
            flex: 1,
            padding: '10px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 8,
            cursor: testing ? 'default' : 'pointer',
            fontFamily: font,
            background: testing ? '#1a1a2e' : 'rgba(0, 212, 255, 0.08)',
            border: testing ? '1px solid #252540' : '1px solid #00d4ff',
            color: testing ? '#555570' : '#00d4ff',
            opacity: !ip.trim() ? 0.5 : 1,
          },
        },
        testing ? 'Testing…' : 'Test connection',
      ),
    ),
    result &&
      React.createElement(
        'div',
        {
          style: {
            padding: '8px 10px',
            fontSize: 11,
            borderRadius: 6,
            background: result.ok ? 'rgba(45, 212, 160, 0.08)' : 'rgba(255, 68, 102, 0.08)',
            border: result.ok
              ? '1px solid rgba(45, 212, 160, 0.35)'
              : '1px solid rgba(255, 68, 102, 0.35)',
            color: result.ok ? '#2dd4a0' : '#ff4466',
            lineHeight: 1.4,
          },
        },
        result.ok
          ? React.createElement(
              React.Fragment,
              null,
              React.createElement(
                'div',
                { style: { fontWeight: 600, marginBottom: 4 } },
                '✓ Connected',
              ),
              React.createElement(
                'div',
                { style: { color: '#c0c0d0', fontFamily: mono, fontSize: 10 } },
                `${result.deviceModel ?? 'Falcon'} · fw ${result.firmwareVersion ?? '?'}`,
              ),
              result.laserInfo &&
                React.createElement(
                  'div',
                  { style: { color: '#8888aa', fontFamily: mono, fontSize: 10, marginTop: 2 } },
                  `Laser: ${result.laserInfo.laserType} · ${result.laserInfo.laserClass}W`,
                ),
            )
          : React.createElement(
              React.Fragment,
              null,
              React.createElement(
                'div',
                { style: { fontWeight: 600, marginBottom: 2 } },
                '✗ Connection failed',
              ),
              React.createElement(
                'div',
                { style: { color: '#ff8ca0', fontSize: 10 } },
                result.error ?? 'Unknown error',
              ),
            ),
      ),
    result?.ok &&
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: handleActivate,
          disabled: alreadyActive,
          style: {
            width: '100%',
            padding: 10,
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 8,
            cursor: alreadyActive ? 'default' : 'pointer',
            fontFamily: font,
            background: alreadyActive ? '#1a1a2e' : 'rgba(45, 212, 160, 0.1)',
            border: alreadyActive ? '1px solid #252540' : '1px solid #2dd4a0',
            color: alreadyActive ? '#555570' : '#2dd4a0',
          },
        },
        alreadyActive ? 'Already active' : 'Use this Falcon',
      ),
  );
}
