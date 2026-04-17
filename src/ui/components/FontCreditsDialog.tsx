import React from 'react';
import { BUNDLED_FONTS, type BundledFont, type FontCategory } from '../../fonts/fontRegistry';

interface FontCreditsDialogProps {
  onClose: () => void;
}

const font = "'DM Sans', system-ui, sans-serif";
const mono = "'JetBrains Mono', monospace";

const CATEGORY_ORDER: FontCategory[] = ['sans', 'serif', 'display', 'script', 'mono', 'stencil', 'engraving'];
const CATEGORY_LABEL: Record<FontCategory, string> = {
  sans: 'Sans-serif',
  serif: 'Serif',
  display: 'Display',
  script: 'Script',
  mono: 'Monospace',
  stencil: 'Stencil',
  engraving: 'Engraving (single-line)',
};

const LICENSE_COLOR: Record<BundledFont['license'], { bg: string; fg: string }> = {
  'OFL-1.1': { bg: 'rgba(45,212,160,0.1)', fg: '#2dd4a0' },
  'Apache-2.0': { bg: 'rgba(0,212,255,0.1)', fg: '#00d4ff' },
  'Public-Domain': { bg: 'rgba(255,212,68,0.1)', fg: '#ffd444' },
};

export function FontCreditsDialog({ onClose }: FontCreditsDialogProps) {
  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    label: CATEGORY_LABEL[cat],
    fonts: BUNDLED_FONTS.filter(f => f.category === cat),
  })).filter(g => g.fonts.length > 0);

  return React.createElement('div', {
    style: {
      position: 'fixed' as const,
      inset: 0,
      zIndex: 2100,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px 0',
      overflowY: 'auto' as const,
    },
    onClick: onClose,
  },
    React.createElement('div', {
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
      style: {
        width: 560,
        maxWidth: '90vw',
        maxHeight: '85vh',
        background: '#12121e',
        border: '1px solid #252540',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column' as const,
        fontFamily: font,
        color: '#e0e0ec',
      },
    },
      React.createElement('div', {
        style: {
          padding: '14px 18px',
          borderBottom: '1px solid #252540',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        },
      },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600 } }, 'Font Credits'),
        React.createElement('button', {
          type: 'button',
          onClick: onClose,
          style: {
            background: 'none',
            border: 'none',
            color: '#555570',
            fontSize: 18,
            cursor: 'pointer',
            padding: '0 4px',
          },
        }, '×'),
      ),

      React.createElement('div', {
        style: { padding: '12px 18px', fontSize: 11, color: '#8888aa', lineHeight: 1.5, flexShrink: 0 },
      },
        'LaserForge bundles the fonts below. All are licensed for commercial redistribution. Full license text files ship with the application at ',
        React.createElement('code', { style: { fontFamily: mono, color: '#c0c0d0' } }, 'fonts/LICENSES/'),
        ' inside the app bundle.'),

      React.createElement('div', {
        style: { flex: 1, overflowY: 'auto' as const, padding: '0 18px 18px', minHeight: 0 },
      },
        ...grouped.map(group =>
          React.createElement('div', { key: group.category, style: { marginBottom: 14 } },
            React.createElement('div', {
              style: {
                fontSize: 10,
                textTransform: 'uppercase' as const,
                letterSpacing: 1,
                color: '#555570',
                marginBottom: 6,
                marginTop: 4,
              },
            }, group.label),
            ...group.fonts.map((f: BundledFont) =>
              React.createElement('div', {
                key: f.family,
                style: {
                  padding: '8px 10px',
                  marginBottom: 4,
                  background: '#0a0a14',
                  border: '1px solid #1a1a2e',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                },
              },
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                  React.createElement('div', {
                    style: {
                      fontSize: 12,
                      fontWeight: 600,
                      marginBottom: 2,
                      fontFamily: f.hersheyFamily ? font : `"${f.family}", ${font}`,
                    },
                  }, f.label),
                  React.createElement('div', {
                    style: { fontSize: 9, color: '#555570', fontFamily: mono, whiteSpace: 'pre-wrap' as const },
                  }, f.copyright),
                ),
                React.createElement('span', {
                  style: {
                    flexShrink: 0,
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 9,
                    fontWeight: 600,
                    fontFamily: mono,
                    background: LICENSE_COLOR[f.license].bg,
                    color: LICENSE_COLOR[f.license].fg,
                    alignSelf: 'flex-start' as const,
                  },
                }, f.license),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
