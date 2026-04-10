import React, { useState, useEffect } from 'react';

const TRIAL_DAYS = 14;
const TRIAL_KEY = 'laserforge_trial_start';
const TRIAL_FINGERPRINT_KEY = 'laserforge_trial_fp';

function isElectronClient(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
  } catch {
    return false;
  }
}

/**
 * Generate a simple browser fingerprint to prevent trial reset by clearing localStorage.
 * Not bulletproof, but enough to deter casual resets.
 */
function getBrowserFingerprint(): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('LaserForge', 2, 2);
  }
  const parts = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    canvas.toDataURL().slice(-50),
  ];
  let hash = 0;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Store trial start in both localStorage and a cookie for redundancy.
 */
function getTrialStart(): number | null {
  const stored = localStorage.getItem(TRIAL_KEY);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }

  const match = document.cookie.match(/laserforge_trial=(\d+)/);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (!Number.isNaN(parsed)) {
      localStorage.setItem(TRIAL_KEY, String(parsed));
      return parsed;
    }
  }

  return null;
}

function setTrialStart(timestamp: number): void {
  localStorage.setItem(TRIAL_KEY, String(timestamp));
  const expires = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `laserforge_trial=${timestamp}; expires=${expires}; path=/; SameSite=Lax`;
  localStorage.setItem(TRIAL_FINGERPRINT_KEY, getBrowserFingerprint());
}

interface TrialInfo {
  started: Date;
  expires: Date;
  daysLeft: number;
  expired: boolean;
}

export function getTrialInfo(): TrialInfo | null {
  const start = getTrialStart();
  if (!start) return null;
  const started = new Date(start);
  const expires = new Date(start + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const daysLeft = Math.max(0, Math.ceil((expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  return { started, expires, daysLeft, expired: daysLeft <= 0 };
}

interface TrialGuardProps {
  children: React.ReactNode;
}

export function TrialGuard({ children }: TrialGuardProps) {
  const [trialInfo, setTrialInfo] = useState<TrialInfo | null>(null);
  const [initialized, setInitialized] = useState(() => isElectronClient());

  useEffect(() => {
    if (isElectronClient()) {
      return;
    }

    let start = getTrialStart();

    if (!start) {
      start = Date.now();
      setTrialStart(start);
    }

    const info = getTrialInfo();
    setTrialInfo(info);
    setInitialized(true);
  }, []);

  const font = "'DM Sans', system-ui, sans-serif";

  if (!initialized) {
    return React.createElement('div', {
      style: { position: 'fixed', inset: 0, background: '#08080f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555570', fontFamily: font },
    }, 'Loading...');
  }

  if (isElectronClient()) {
    return React.createElement(React.Fragment, null, children);
  }

  if (trialInfo?.expired) {
    return React.createElement('div', {
      style: {
        position: 'fixed', inset: 0, background: '#08080f',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: font,
      },
    },
      React.createElement('div', {
        style: { textAlign: 'center' as const, maxWidth: 420, padding: 40 },
      },
        React.createElement('div', {
          style: { fontSize: 48, marginBottom: 16 },
        }, '⏱'),
        React.createElement('h1', {
          style: { color: '#e0e0ec', fontSize: 22, fontWeight: 600, marginBottom: 12 },
        }, 'Trial Period Ended'),
        React.createElement('p', {
          style: { color: '#8888aa', fontSize: 14, lineHeight: 1.6, marginBottom: 24 },
        }, `Your ${TRIAL_DAYS}-day free trial of LaserForge expired on ${trialInfo.expires.toLocaleDateString()}. Thank you for testing!`),
        React.createElement('p', {
          style: { color: '#555570', fontSize: 12, lineHeight: 1.6, marginBottom: 24 },
        }, 'To continue using LaserForge, contact us for a license key or extended trial.'),
        React.createElement('a', {
          href: 'mailto:support@laserforge.app?subject=LaserForge%20License',
          style: {
            display: 'inline-block', padding: '12px 32px',
            background: 'rgba(0,212,255,0.1)', border: '1px solid #00d4ff',
            borderRadius: 8, color: '#00d4ff', fontSize: 14, fontWeight: 600,
            textDecoration: 'none', fontFamily: font,
          },
        }, 'Contact for License'),
        React.createElement('div', {
          style: { marginTop: 16 },
        },
          React.createElement('a', {
            href: 'https://laserforge.app',
            style: { color: '#555570', fontSize: 11, textDecoration: 'none' },
          }, 'laserforge.app'),
        ),
      ),
    );
  }

  return React.createElement(React.Fragment, null,
    trialInfo && trialInfo.daysLeft <= 7 && React.createElement('div', {
      style: {
        background: trialInfo.daysLeft <= 3 ? 'rgba(255,68,102,0.08)' : 'rgba(255,212,68,0.06)',
        borderBottom: trialInfo.daysLeft <= 3 ? '1px solid rgba(255,68,102,0.2)' : '1px solid rgba(255,212,68,0.15)',
        padding: '6px 18px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: font, fontSize: 11, flexShrink: 0,
      },
    },
      React.createElement('span', {
        style: { color: trialInfo.daysLeft <= 3 ? '#ff4466' : '#ffd444' },
      }, `⏱ Trial: ${trialInfo.daysLeft} day${trialInfo.daysLeft !== 1 ? 's' : ''} remaining`),
      React.createElement('a', {
        href: 'mailto:support@laserforge.app?subject=LaserForge%20License',
        style: {
          color: '#00d4ff', textDecoration: 'none', fontSize: 10,
          padding: '2px 10px', border: '1px solid rgba(0,212,255,0.3)',
          borderRadius: 4,
        },
      }, 'Get License'),
    ),

    trialInfo && trialInfo.daysLeft > 7 && React.createElement('div', {
      style: {
        background: 'rgba(0,212,255,0.03)',
        borderBottom: '1px solid #1a1a2e',
        padding: '4px 18px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: font, fontSize: 10, flexShrink: 0,
      },
    },
      React.createElement('span', { style: { color: '#555570' } },
        `Free trial — ${trialInfo.daysLeft} days remaining`,
      ),
    ),

    children,
  );
}
