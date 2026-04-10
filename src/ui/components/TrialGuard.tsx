import React, { useState, useEffect } from 'react';

const CODE_STORAGE_KEY = 'laserforge_access_code';

/**
 * Access codes with their creation dates.
 * Generate a new code for each tester. When the code expires, they can't switch browsers.
 *
 * To add a new tester: add a line with their code and today's date.
 * To extend a trial: update the date.
 * To revoke access: remove their line.
 */
const ACCESS_CODES: Record<string, { name: string; created: string; days: number }> = {
  'TESTER-ALPHA-2026': { name: 'Alpha Tester', created: '2026-04-10', days: 14 },
  'TESTER-BETA-2026': { name: 'Beta Tester', created: '2026-04-10', days: 14 },
  'TESTER-GAMMA-2026': { name: 'Gamma Tester', created: '2026-04-10', days: 14 },
  'DEMO-REVIEW-2026': { name: 'Demo Review', created: '2026-04-10', days: 30 },
  // Add more codes here as needed:
  // 'UNIQUE-CODE-HERE': { name: 'Tester Name', created: 'YYYY-MM-DD', days: 14 },
};

interface TrialInfo {
  code: string;
  name: string;
  started: Date;
  expires: Date;
  daysLeft: number;
  expired: boolean;
}

function validateCode(code: string): TrialInfo | null {
  const entry = ACCESS_CODES[code.toUpperCase().trim()];
  if (!entry) return null;

  const started = new Date(entry.created);
  const expires = new Date(started.getTime() + entry.days * 24 * 60 * 60 * 1000);
  const daysLeft = Math.max(0, Math.ceil((expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

  return {
    code: code.toUpperCase().trim(),
    name: entry.name,
    started,
    expires,
    daysLeft,
    expired: daysLeft <= 0,
  };
}

interface TrialGuardProps {
  children: React.ReactNode;
}

export function TrialGuard({ children }: TrialGuardProps) {
  const [accessCode, setAccessCode] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [trialInfo, setTrialInfo] = useState<TrialInfo | null>(null);
  const [error, setError] = useState('');
  const [initialized, setInitialized] = useState(false);

  const font = "'DM Sans', system-ui, sans-serif";

  useEffect(() => {
    const saved = localStorage.getItem(CODE_STORAGE_KEY);
    if (saved) {
      const info = validateCode(saved);
      if (info && !info.expired) {
        setAccessCode(saved);
        setTrialInfo(info);
      } else if (info?.expired) {
        setAccessCode(saved);
        setTrialInfo(info);
      } else {
        localStorage.removeItem(CODE_STORAGE_KEY);
      }
    }

    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get('code');
    if (urlCode) {
      const info = validateCode(urlCode);
      if (info) {
        setAccessCode(urlCode.toUpperCase().trim());
        setTrialInfo(info);
        localStorage.setItem(CODE_STORAGE_KEY, urlCode.toUpperCase().trim());
        window.history.replaceState({}, '', window.location.pathname);
      }
    }

    setInitialized(true);
  }, []);

  const handleSubmitCode = () => {
    setError('');
    const info = validateCode(codeInput);

    if (!info) {
      setError('Invalid access code');
      return;
    }

    if (info.expired) {
      setError(`This code expired on ${info.expires.toLocaleDateString()}`);
      setTrialInfo(info);
      setAccessCode(codeInput.toUpperCase().trim());
      return;
    }

    setAccessCode(codeInput.toUpperCase().trim());
    setTrialInfo(info);
    localStorage.setItem(CODE_STORAGE_KEY, codeInput.toUpperCase().trim());
  };

  if (!initialized) {
    return React.createElement('div', {
      style: { position: 'fixed', inset: 0, background: '#08080f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555570', fontFamily: font },
    }, 'Loading...');
  }

  if (!accessCode || !trialInfo) {
    return React.createElement('div', {
      style: {
        position: 'fixed', inset: 0, background: '#08080f',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: font,
      },
    },
      React.createElement('div', {
        style: { textAlign: 'center' as const, maxWidth: 380, padding: 40 },
      },
        React.createElement('div', { style: { fontSize: 36, marginBottom: 8 } }, '⚡'),
        React.createElement('h1', { style: { color: '#e0e0ec', fontSize: 24, fontWeight: 700, marginBottom: 4 } }, 'LaserForge'),
        React.createElement('p', { style: { color: '#555570', fontSize: 12, marginBottom: 32 } }, 'Enter your access code to begin'),

        React.createElement('input', {
          type: 'text',
          value: codeInput,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setCodeInput(e.target.value); setError(''); },
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSubmitCode(); },
          placeholder: 'ACCESS-CODE-HERE',
          autoFocus: true,
          style: {
            width: '100%', padding: '14px 16px', marginBottom: 12,
            background: '#12121e', border: error ? '1px solid #ff4466' : '1px solid #252540',
            borderRadius: 10, color: '#e0e0ec', fontSize: 16,
            textAlign: 'center' as const, letterSpacing: 2,
            fontFamily: "'JetBrains Mono', monospace",
            outline: 'none', textTransform: 'uppercase' as const,
          },
        }),

        error && React.createElement('div', {
          style: { color: '#ff4466', fontSize: 12, marginBottom: 12 },
        }, error),

        React.createElement('button', {
          onClick: handleSubmitCode,
          disabled: !codeInput.trim(),
          style: {
            width: '100%', padding: '12px',
            background: codeInput.trim() ? 'rgba(0,212,255,0.1)' : '#1a1a2e',
            border: codeInput.trim() ? '1px solid #00d4ff' : '1px solid #252540',
            borderRadius: 8, color: codeInput.trim() ? '#00d4ff' : '#333355',
            fontSize: 14, fontWeight: 600, cursor: codeInput.trim() ? 'pointer' : 'default',
            fontFamily: font,
          },
        }, 'Enter LaserForge'),

        React.createElement('p', {
          style: { color: '#333355', fontSize: 10, marginTop: 24 },
        }, "Don't have a code? Contact us for trial access."),
      ),
    );
  }

  if (trialInfo.expired) {
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
        React.createElement('div', { style: { fontSize: 48, marginBottom: 16 } }, '⏱'),
        React.createElement('h1', { style: { color: '#e0e0ec', fontSize: 22, fontWeight: 600, marginBottom: 12 } }, 'Trial Period Ended'),
        React.createElement('p', { style: { color: '#8888aa', fontSize: 14, lineHeight: 1.6, marginBottom: 8 } },
          `Hi ${trialInfo.name},`,
        ),
        React.createElement('p', { style: { color: '#8888aa', fontSize: 13, lineHeight: 1.6, marginBottom: 24 } },
          `Your access expired on ${trialInfo.expires.toLocaleDateString()}. Thank you for testing LaserForge!`,
        ),
        React.createElement('a', {
          href: 'mailto:support@laserforge.app?subject=LaserForge%20License%20Request',
          style: {
            display: 'inline-block', padding: '12px 32px',
            background: 'rgba(0,212,255,0.1)', border: '1px solid #00d4ff',
            borderRadius: 8, color: '#00d4ff', fontSize: 14, fontWeight: 600,
            textDecoration: 'none', fontFamily: font,
          },
        }, 'Request Extended Access'),

        React.createElement('div', {
          style: { marginTop: 24 },
        },
          React.createElement('button', {
            onClick: () => {
              localStorage.removeItem(CODE_STORAGE_KEY);
              setAccessCode('');
              setTrialInfo(null);
              setCodeInput('');
            },
            style: { background: 'none', border: 'none', color: '#333355', fontSize: 10, cursor: 'pointer', fontFamily: font },
          }, 'Try a different code'),
        ),
      ),
    );
  }

  return React.createElement(React.Fragment, null,
    trialInfo.daysLeft <= 7 && React.createElement('div', {
      style: {
        background: trialInfo.daysLeft <= 3 ? 'rgba(255,68,102,0.08)' : 'rgba(255,212,68,0.06)',
        borderBottom: trialInfo.daysLeft <= 3 ? '1px solid rgba(255,68,102,0.2)' : '1px solid rgba(255,212,68,0.15)',
        padding: '6px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: font, fontSize: 11, flexShrink: 0,
      },
    },
      React.createElement('span', {
        style: { color: trialInfo.daysLeft <= 3 ? '#ff4466' : '#ffd444' },
      }, `⏱ ${trialInfo.name} — ${trialInfo.daysLeft} day${trialInfo.daysLeft !== 1 ? 's' : ''} remaining`),
      React.createElement('a', {
        href: 'mailto:support@laserforge.app?subject=LaserForge%20License',
        style: { color: '#00d4ff', textDecoration: 'none', fontSize: 10, padding: '2px 10px', border: '1px solid rgba(0,212,255,0.3)', borderRadius: 4 },
      }, 'Get License'),
    ),

    trialInfo.daysLeft > 7 && React.createElement('div', {
      style: {
        background: 'rgba(0,212,255,0.03)', borderBottom: '1px solid #1a1a2e',
        padding: '4px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: font, fontSize: 10, flexShrink: 0,
      },
    },
      React.createElement('span', { style: { color: '#555570' } },
        `Welcome ${trialInfo.name} — ${trialInfo.daysLeft} days remaining`,
      ),
    ),

    children,
  );
}
