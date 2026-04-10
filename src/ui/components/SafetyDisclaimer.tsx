import React, { useState } from 'react';

const SAFETY_KEY = 'laserforge_safety_acknowledged';

interface SafetyDisclaimerProps {
  children: React.ReactNode;
}

export function SafetyDisclaimer({ children }: SafetyDisclaimerProps) {
  const [acknowledged, setAcknowledged] = useState(() =>
    localStorage.getItem(SAFETY_KEY) === 'true',
  );
  const [checked, setChecked] = useState(false);

  const font = "'DM Sans', system-ui, sans-serif";

  if (acknowledged) return React.createElement(React.Fragment, null, children);

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, background: '#08080f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: font, padding: 20, zIndex: 9999,
    },
  },
    React.createElement('div', {
      style: { maxWidth: 520, width: '100%', textAlign: 'left' as const },
    },
      React.createElement('div', { style: { fontSize: 36, marginBottom: 12, textAlign: 'center' as const } }, '⚠️'),
      React.createElement('h1', {
        style: { color: '#e0e0ec', fontSize: 22, fontWeight: 700, marginBottom: 16, textAlign: 'center' as const },
      }, 'Laser Safety'),

      React.createElement('div', {
        style: {
          background: '#12121e', border: '1px solid #252540', borderRadius: 12,
          padding: '20px 24px', marginBottom: 20, maxHeight: 340, overflowY: 'auto' as const,
          fontSize: 13, lineHeight: 1.8, color: '#c0c0d0',
        },
      },
        React.createElement('p', { style: { marginBottom: 12, fontWeight: 600, color: '#ff4466' } },
          'Lasers are dangerous. They can cause fires, eye damage, and skin burns.',
        ),
        React.createElement('p', { style: { marginBottom: 12 } },
          'By using LaserForge, you acknowledge that:',
        ),
        React.createElement('p', { style: { marginBottom: 8, paddingLeft: 16 } },
          '• You are solely responsible for the safe operation of your laser.',
        ),
        React.createElement('p', { style: { marginBottom: 8, paddingLeft: 16 } },
          '• You will NEVER leave a laser running unattended.',
        ),
        React.createElement('p', { style: { marginBottom: 8, paddingLeft: 16 } },
          '• You will always wear appropriate laser safety eyewear rated for your laser\'s wavelength.',
        ),
        React.createElement('p', { style: { marginBottom: 8, paddingLeft: 16 } },
          '• You will ensure adequate ventilation when cutting or engraving any material.',
        ),
        React.createElement('p', { style: { marginBottom: 8, paddingLeft: 16 } },
          '• You will keep a fire extinguisher accessible at all times.',
        ),
        React.createElement('p', { style: { marginBottom: 8, paddingLeft: 16 } },
          '• You will not cut or engrave materials that produce toxic fumes (PVC, vinyl, polycarbonate, ABS) without proper fume extraction.',
        ),
        React.createElement('p', { style: { marginBottom: 8, paddingLeft: 16 } },
          '• You understand that LaserForge is software only. It does not control or guarantee safe laser operation.',
        ),
        React.createElement('p', { style: { marginTop: 16, color: '#8888aa', fontSize: 11 } },
          'LaserForge and its developers are not liable for any damage, injury, fire, or loss resulting from the use of this software. Laser equipment is operated entirely at your own risk. This software is provided "as is" without warranty of any kind.',
        ),
      ),

      React.createElement('label', {
        style: {
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
          cursor: 'pointer', fontSize: 13, color: '#e0e0ec',
        },
      },
        React.createElement('input', {
          type: 'checkbox',
          checked,
          onChange: () => setChecked(!checked),
          style: { width: 18, height: 18, accentColor: '#00d4ff', cursor: 'pointer' },
        }),
        'I have read and understand these safety warnings',
      ),

      React.createElement('button', {
        onClick: () => {
          localStorage.setItem(SAFETY_KEY, 'true');
          setAcknowledged(true);
        },
        disabled: !checked,
        style: {
          width: '100%', padding: '14px',
          background: checked ? 'rgba(0,212,255,0.1)' : '#1a1a2e',
          border: checked ? '1px solid #00d4ff' : '1px solid #252540',
          borderRadius: 10, color: checked ? '#00d4ff' : '#333355',
          fontSize: 15, fontWeight: 600,
          cursor: checked ? 'pointer' : 'default',
          fontFamily: font,
        },
      }, 'I Understand — Continue to LaserForge'),
    ),
  );
}
