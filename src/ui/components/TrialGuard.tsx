import React, { useState, useEffect } from 'react';

const STORAGE_KEY = 'laserforge_license';
const PRO_FLAG_KEY = 'laserforge_pro';

/**
 * Trial codes — for testers, expire after N days from creation date.
 */
const TRIAL_CODES: Record<string, { name: string; created: string; days: number }> = {
  'TESTER-ALPHA-2026': { name: 'Alpha Tester', created: '2026-04-10', days: 14 },
  'TESTER-BETA-2026': { name: 'Beta Tester', created: '2026-04-10', days: 14 },
  'TESTER-GAMMA-2026': { name: 'Gamma Tester', created: '2026-04-10', days: 14 },
  'DEMO-REVIEW-2026': { name: 'Demo Review', created: '2026-04-10', days: 30 },
};

/**
 * License keys — permanent access, sold via Gumroad.
 * Format: LF-XXXX-XXXX-XXXX (16 chars + dashes)
 *
 * For now, hardcoded list. When you launch, replace with server-side validation
 * via Gumroad's license verification API.
 *
 * To add a buyer:
 * 1. Generate a unique key in Gumroad
 * 2. Add it here with the buyer's name
 * 3. Push the change
 */
const LICENSE_KEYS: Record<string, string> = {
  'LF-TEST-DEMO-0001': 'Test License',
  // 'LF-XXXX-XXXX-XXXX': 'Buyer Name',
};

interface AccessInfo {
  type: 'trial' | 'license' | 'free';
  code: string;
  name: string;
  daysLeft?: number;
  expired?: boolean;
}

function validateAccess(code: string): AccessInfo | null {
  const upper = code.toUpperCase().trim();

  // Check license keys first (permanent)
  if (LICENSE_KEYS[upper]) {
    return {
      type: 'license',
      code: upper,
      name: LICENSE_KEYS[upper],
    };
  }

  // Check trial codes
  if (TRIAL_CODES[upper]) {
    const entry = TRIAL_CODES[upper];
    const started = new Date(entry.created);
    const expires = new Date(started.getTime() + entry.days * 24 * 60 * 60 * 1000);
    const daysLeft = Math.max(0, Math.ceil((expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    return {
      type: 'trial',
      code: upper,
      name: entry.name,
      daysLeft,
      expired: daysLeft <= 0,
    };
  }

  return null;
}

/** Check if PRO features should be unlocked */
export function isProUnlocked(): boolean {
  try {
    return localStorage.getItem(PRO_FLAG_KEY) === 'true';
  } catch {
    return false;
  }
}

interface TrialGuardProps {
  children: React.ReactNode;
}

export function TrialGuard({ children }: TrialGuardProps) {
  const [accessInfo, setAccessInfo] = useState<AccessInfo | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [error, setError] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [mode, setMode] = useState<'free' | 'enter'>('free');

  const font = "'DM Sans', system-ui, sans-serif";

  useEffect(() => {
    // Check saved code
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const info = validateAccess(saved);
        if (info) {
          setAccessInfo(info);
          if (info.type === 'license' || (info.type === 'trial' && !info.expired)) {
            localStorage.setItem(PRO_FLAG_KEY, 'true');
          } else {
            localStorage.removeItem(PRO_FLAG_KEY);
          }
        } else {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(PRO_FLAG_KEY);
        }
      }

      // Check URL parameter
      const params = new URLSearchParams(window.location.search);
      const urlCode = params.get('code') || params.get('license');
      if (urlCode) {
        const info = validateAccess(urlCode);
        if (info) {
          setAccessInfo(info);
          localStorage.setItem(STORAGE_KEY, urlCode.toUpperCase().trim());
          if (info.type === 'license' || (info.type === 'trial' && !info.expired)) {
            localStorage.setItem(PRO_FLAG_KEY, 'true');
          }
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    } catch { /* ignore */ }

    setInitialized(true);
  }, []);

  const handleSubmitCode = () => {
    setError('');
    const info = validateAccess(codeInput);

    if (!info) {
      setError('Invalid code or license key');
      return;
    }

    if (info.type === 'trial' && info.expired) {
      setError(`This trial code expired ${info.daysLeft === 0 ? 'today' : `${-info.daysLeft!} days ago`}`);
      return;
    }

    setAccessInfo(info);
    try {
      localStorage.setItem(STORAGE_KEY, codeInput.toUpperCase().trim());
      if (info.type === 'license' || (info.type === 'trial' && !info.expired)) {
        localStorage.setItem(PRO_FLAG_KEY, 'true');
      }
    } catch { /* ignore */ }
  };

  const handleContinueFree = () => {
    setAccessInfo({ type: 'free', code: '', name: 'Free User' });
    try {
      localStorage.removeItem(PRO_FLAG_KEY);
    } catch { /* ignore */ }
  };

  if (!initialized) {
    return React.createElement('div', {
      style: { position: 'fixed', inset: 0, background: '#08080f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555570', fontFamily: font },
    }, 'Loading...');
  }

  // Show landing screen if no access yet
  if (!accessInfo) {
    return React.createElement('div', {
      style: {
        position: 'fixed', inset: 0, background: '#08080f',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: font, padding: 20,
      },
    },
      React.createElement('div', {
        style: { textAlign: 'center' as const, maxWidth: 440, width: '100%' },
      },
        React.createElement('div', { style: { fontSize: 42, marginBottom: 8 } }, '⚡'),
        React.createElement('h1', { style: { color: '#e0e0ec', fontSize: 28, fontWeight: 700, marginBottom: 4 } }, 'LaserForge'),
        React.createElement('p', { style: { color: '#8888aa', fontSize: 13, marginBottom: 28 } }, 'The laser app that helps you avoid mistakes before they happen'),

        // Mode toggle: enter code vs continue free
        mode === 'free' && React.createElement('div', null,
          React.createElement('button', {
            onClick: handleContinueFree,
            style: {
              width: '100%', padding: '14px',
              background: 'rgba(45,212,160,0.1)', border: '1px solid #2dd4a0',
              borderRadius: 10, color: '#2dd4a0',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              fontFamily: font, marginBottom: 10,
            },
          }, '⚡ Start Free (EASY mode)'),

          React.createElement('button', {
            onClick: () => setMode('enter'),
            style: {
              width: '100%', padding: '14px',
              background: 'rgba(0,212,255,0.1)', border: '1px solid #00d4ff',
              borderRadius: 10, color: '#00d4ff',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              fontFamily: font, marginBottom: 16,
            },
          }, 'Enter License Key or Trial Code'),

          React.createElement('a', {
            href: '/landing.html',
            target: '_blank',
            rel: 'noreferrer',
            style: {
              display: 'inline-block', color: '#555570', fontSize: 11,
              textDecoration: 'none', borderBottom: '1px solid #1a1a2e',
              paddingBottom: 2,
            },
          }, 'Get PRO for $30 →'),
        ),

        // Code entry
        mode === 'enter' && React.createElement('div', null,
          React.createElement('input', {
            type: 'text',
            value: codeInput,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setCodeInput(e.target.value); setError(''); },
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSubmitCode(); },
            placeholder: 'LF-XXXX-XXXX-XXXX',
            autoFocus: true,
            style: {
              width: '100%', padding: '14px 16px', marginBottom: 12,
              background: '#12121e', border: error ? '1px solid #ff4466' : '1px solid #252540',
              borderRadius: 10, color: '#e0e0ec', fontSize: 16,
              textAlign: 'center' as const, letterSpacing: 2,
              fontFamily: "'JetBrains Mono', monospace",
              outline: 'none', textTransform: 'uppercase' as const,
              boxSizing: 'border-box' as const,
            },
          }),

          error && React.createElement('div', {
            style: { color: '#ff4466', fontSize: 12, marginBottom: 12 },
          }, error),

          React.createElement('button', {
            onClick: handleSubmitCode,
            disabled: !codeInput.trim(),
            style: {
              width: '100%', padding: '12px', marginBottom: 8,
              background: codeInput.trim() ? 'rgba(0,212,255,0.1)' : '#1a1a2e',
              border: codeInput.trim() ? '1px solid #00d4ff' : '1px solid #252540',
              borderRadius: 8, color: codeInput.trim() ? '#00d4ff' : '#333355',
              fontSize: 14, fontWeight: 600, cursor: codeInput.trim() ? 'pointer' : 'default',
              fontFamily: font,
            },
          }, 'Activate'),

          React.createElement('button', {
            onClick: () => { setMode('free'); setError(''); setCodeInput(''); },
            style: {
              background: 'none', border: 'none', color: '#555570',
              fontSize: 11, cursor: 'pointer', fontFamily: font,
            },
          }, '← Back'),
        ),
      ),
    );
  }

  // Trial expired
  if (accessInfo.type === 'trial' && accessInfo.expired) {
    return React.createElement('div', {
      style: {
        position: 'fixed', inset: 0, background: '#08080f',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: font, padding: 20,
      },
    },
      React.createElement('div', {
        style: { textAlign: 'center' as const, maxWidth: 420 },
      },
        React.createElement('div', { style: { fontSize: 48, marginBottom: 16 } }, '⏱'),
        React.createElement('h1', { style: { color: '#e0e0ec', fontSize: 22, fontWeight: 600, marginBottom: 12 } }, 'Trial Period Ended'),
        React.createElement('p', { style: { color: '#8888aa', fontSize: 14, marginBottom: 20 } }, `Hi ${accessInfo.name}, your trial has ended.`),
        React.createElement('p', { style: { color: '#555570', fontSize: 12, marginBottom: 24 } }, 'Continue using LaserForge with EASY mode for free, or unlock PRO for $30.'),

        React.createElement('button', {
          onClick: handleContinueFree,
          style: {
            width: '100%', padding: '12px', marginBottom: 8,
            background: 'rgba(45,212,160,0.1)', border: '1px solid #2dd4a0',
            borderRadius: 10, color: '#2dd4a0',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            fontFamily: font,
          },
        }, 'Continue with Free EASY mode'),

        React.createElement('a', {
          href: '/landing.html',
          style: {
            display: 'block', padding: '12px', marginTop: 8,
            background: 'rgba(0,212,255,0.1)', border: '1px solid #00d4ff',
            borderRadius: 10, color: '#00d4ff',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            fontFamily: font, textDecoration: 'none',
          },
        }, 'Buy PRO License — $30'),
      ),
    );
  }

  // Active access — show app with banner
  const showBanner = accessInfo.type === 'trial' && accessInfo.daysLeft !== undefined && accessInfo.daysLeft <= 7;
  const showFreeBanner = accessInfo.type === 'free';

  return React.createElement(React.Fragment, null,
    showBanner && React.createElement('div', {
      style: {
        background: accessInfo.daysLeft! <= 3 ? 'rgba(255,68,102,0.08)' : 'rgba(255,212,68,0.06)',
        borderBottom: accessInfo.daysLeft! <= 3 ? '1px solid rgba(255,68,102,0.2)' : '1px solid rgba(255,212,68,0.15)',
        padding: '6px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: font, fontSize: 11, flexShrink: 0,
      },
    },
      React.createElement('span', {
        style: { color: accessInfo.daysLeft! <= 3 ? '#ff4466' : '#ffd444' },
      }, `⏱ Trial: ${accessInfo.daysLeft} day${accessInfo.daysLeft !== 1 ? 's' : ''} remaining`),
      React.createElement('a', {
        href: '/landing.html',
        style: { color: '#00d4ff', textDecoration: 'none', fontSize: 10, padding: '2px 10px', border: '1px solid rgba(0,212,255,0.3)', borderRadius: 4 },
      }, 'Buy PRO $30'),
    ),

    showFreeBanner && React.createElement('div', {
      style: {
        background: 'rgba(0,212,255,0.03)', borderBottom: '1px solid #1a1a2e',
        padding: '4px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: font, fontSize: 10, flexShrink: 0,
      },
    },
      React.createElement('span', { style: { color: '#555570' } }, 'EASY mode (free) — Some features locked'),
      React.createElement('a', {
        href: '/landing.html',
        style: { color: '#00d4ff', textDecoration: 'none', fontSize: 10, padding: '2px 10px', border: '1px solid rgba(0,212,255,0.3)', borderRadius: 4 },
      }, 'Unlock PRO $30'),
    ),

    children,
  );
}
