import React, { useEffect, useState } from 'react';
import { entitlementService, tierDisplayName } from '../../entitlements';
import type { EntitlementState } from '../../entitlements';

export { isProUnlocked } from '../utils/proGate';

const STORAGE_KEY = 'laserforge_license';

interface TrialGuardProps {
  children: React.ReactNode;
}

export function TrialGuard({ children }: TrialGuardProps) {
  const font = "'DM Sans', system-ui, sans-serif";
  const [snap, setSnap] = useState<EntitlementState>(() => entitlementService.getState());
  const [ready, setReady] = useState(false);
  const [sessionFree, setSessionFree] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'free' | 'enter'>('free');

  useEffect(() => {
    return entitlementService.onChange(() => {
      setSnap(entitlementService.getState());
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await entitlementService.initialize();
      if (cancelled) return;

      const params = new URLSearchParams(window.location.search);
      const urlCode = params.get('code') || params.get('license');
      if (urlCode) {
        window.history.replaceState({}, '', window.location.pathname);
        const result = await entitlementService.activate(urlCode);
        if (!result.ok && result.error) {
          console.warn('[TrialGuard] URL license activation failed:', result.error);
        }
      }

      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmitCode = async () => {
    setError('');
    const result = await entitlementService.activate(codeInput);
    if (!result.ok) {
      setError(result.error ?? 'Invalid code or license key');
      return;
    }
    setCodeInput('');
  };

  const handleContinueFree = () => {
    entitlementService.skipToFreeSession();
    setSessionFree(true);
  };

  const showApp =
    ready &&
    (snap.tier === 'developer' || snap.hasPro || (snap.tier === 'free' && sessionFree));

  const savedLicense = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  const showLanding =
    ready && !showApp && !savedLicense && snap.tier !== 'developer';

  if (!ready) {
    return React.createElement(
      'div',
      {
        style: {
          position: 'fixed',
          inset: 0,
          background: '#08080f',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#555570',
          fontFamily: font,
        },
      },
      'Loading...',
    );
  }

  if (showLanding) {
    return React.createElement(
      'div',
      {
        style: {
          position: 'fixed',
          inset: 0,
          background: '#08080f',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: font,
          padding: 20,
        },
      },
      React.createElement(
        'div',
        {
          style: { textAlign: 'center' as const, maxWidth: 440, width: '100%' },
        },
        React.createElement('div', { style: { fontSize: 42, marginBottom: 8 } }, '\u26A1'),
        React.createElement(
          'h1',
          { style: { color: '#e0e0ec', fontSize: 28, fontWeight: 700, marginBottom: 4 } },
          'LaserForge',
        ),
        React.createElement(
          'p',
          { style: { color: '#8888aa', fontSize: 13, marginBottom: 28 } },
          'The laser app that helps you avoid mistakes before they happen',
        ),

        mode === 'free' &&
          React.createElement(
            'div',
            null,
            React.createElement(
              'button',
              {
                onClick: handleContinueFree,
                style: {
                  width: '100%',
                  padding: '14px',
                  background: 'rgba(45,212,160,0.1)',
                  border: '1px solid #2dd4a0',
                  borderRadius: 10,
                  color: '#2dd4a0',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: font,
                  marginBottom: 10,
                },
              },
              '\u26A1 Start Free (EASY mode)',
            ),

            React.createElement(
              'button',
              {
                onClick: () => setMode('enter'),
                style: {
                  width: '100%',
                  padding: '14px',
                  background: 'rgba(0,212,255,0.1)',
                  border: '1px solid #00d4ff',
                  borderRadius: 10,
                  color: '#00d4ff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: font,
                  marginBottom: 16,
                },
              },
              'Enter License Key or Tester Key',
            ),

            React.createElement(
              'a',
              {
                href: '/landing.html',
                target: '_blank',
                rel: 'noreferrer',
                style: {
                  display: 'inline-block',
                  color: '#555570',
                  fontSize: 11,
                  textDecoration: 'none',
                  borderBottom: '1px solid #1a1a2e',
                  paddingBottom: 2,
                },
              },
              'PRO access is temporarily open',
            ),
          ),

        mode === 'enter' &&
          React.createElement(
            'div',
            null,
            React.createElement('input', {
              type: 'text',
              value: codeInput,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                setCodeInput(e.target.value);
                setError('');
              },
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter') handleSubmitCode();
              },
              placeholder: 'LF-XXXX / TF-NAME-XXXXXXXX',
              autoFocus: true,
              style: {
                width: '100%',
                padding: '14px 16px',
                marginBottom: 12,
                background: '#12121e',
                border: error ? '1px solid #ff4466' : '1px solid #252540',
                borderRadius: 10,
                color: '#e0e0ec',
                fontSize: 16,
                textAlign: 'center' as const,
                letterSpacing: 2,
                fontFamily: "'JetBrains Mono', monospace",
                outline: 'none',
                textTransform: 'uppercase' as const,
                boxSizing: 'border-box' as const,
              },
            }),

            error &&
              React.createElement(
                'div',
                { style: { color: '#ff4466', fontSize: 12, marginBottom: 12 } },
                error,
              ),

            React.createElement(
              'button',
              {
                onClick: handleSubmitCode,
                disabled: !codeInput.trim(),
                style: {
                  width: '100%',
                  padding: '12px',
                  marginBottom: 8,
                  background: codeInput.trim() ? 'rgba(0,212,255,0.1)' : '#1a1a2e',
                  border: codeInput.trim() ? '1px solid #00d4ff' : '1px solid #252540',
                  borderRadius: 8,
                  color: codeInput.trim() ? '#00d4ff' : '#333355',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: codeInput.trim() ? 'pointer' : 'default',
                  fontFamily: font,
                },
              },
              'Activate',
            ),

            React.createElement(
              'button',
              {
                onClick: () => {
                  setMode('free');
                  setError('');
                  setCodeInput('');
                },
                style: {
                  background: 'none',
                  border: 'none',
                  color: '#555570',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontFamily: font,
                },
              },
              '← Back',
            ),
          ),
      ),
    );
  }

  const showDevBanner = snap.tier === 'developer';
  const showTesterBanner = snap.tier === 'tester_permanent';
  const showPaidBanner = snap.tier === 'paid';
  const showFreeBanner = snap.tier === 'free' && sessionFree;

  return React.createElement(
    React.Fragment,
    null,
    showDevBanner &&
      React.createElement(
        'div',
        {
          style: {
            background: 'rgba(0,212,255,0.06)',
            borderBottom: '1px solid rgba(0,212,255,0.2)',
            padding: '6px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: font,
            fontSize: 11,
            flexShrink: 0,
          },
        },
        React.createElement(
          'span',
          { style: { color: '#00d4ff' } },
          `\u26A1 ${tierDisplayName(snap.tier)} build — full PRO (dev auto-unlock)`,
        ),
      ),

    (showTesterBanner || showPaidBanner) &&
      React.createElement(
        'div',
        {
          style: {
            background: 'rgba(45,212,160,0.06)',
            borderBottom: '1px solid rgba(45,212,160,0.2)',
            padding: '6px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: font,
            fontSize: 11,
            flexShrink: 0,
          },
        },
        React.createElement(
          'span',
          { style: { color: '#2dd4a0' } },
          showTesterBanner
            ? `\u26A1 Tester entitlement — full PRO (${snap.label ?? 'tester'})`
            : `PRO license active${snap.label ? ` (${snap.label})` : ''}`,
        ),
        React.createElement(
          'a',
          {
            href: '/landing.html',
            style: {
              color: '#00d4ff',
              textDecoration: 'none',
              fontSize: 10,
              padding: '2px 10px',
              border: '1px solid rgba(0,212,255,0.3)',
              borderRadius: 4,
            },
          },
          'Manage / info',
        ),
      ),

    showFreeBanner &&
      React.createElement(
        'div',
        {
          style: {
            background: 'rgba(0,212,255,0.03)',
            borderBottom: '1px solid #1a1a2e',
            padding: '4px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: font,
            fontSize: 10,
            flexShrink: 0,
          },
        },
        React.createElement('span', { style: { color: '#555570' } }, 'EASY mode — PRO tools temporarily unlocked'),
        React.createElement(
          'a',
          {
            href: '/landing.html',
            style: {
              color: '#00d4ff',
              textDecoration: 'none',
              fontSize: 10,
              padding: '2px 10px',
              border: '1px solid rgba(0,212,255,0.3)',
              borderRadius: 4,
            },
          },
          'PRO access open',
        ),
      ),

    children,
  );
}
