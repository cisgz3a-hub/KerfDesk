import React from 'react';

interface JogProps {
  jogStep: number;
  setJogStep: (step: number) => void;
  onJog: (axis: 'X' | 'Y', distance: number) => void;
  onHome: () => void;
}

const font = "'DM Sans', system-ui, sans-serif";
const mono = "'JetBrains Mono', monospace";

const jogBtnStyle: React.CSSProperties = {
  padding: '10px', fontSize: 16, borderRadius: 6, cursor: 'pointer',
  background: '#0a0a14', border: '1px solid #252540', color: '#c0c0d0',
  fontFamily: font, lineHeight: 1,
};

const jogCellStyle: React.CSSProperties = {
  ...jogBtnStyle,
  width: 38,
  height: 38,
  padding: 0,
  fontSize: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export function Jog({ jogStep, setJogStep, onJog, onHome }: JogProps) {
  const jogCell = (label: string, axis: 'X' | 'Y', distance: number, tooltip: string) =>
    React.createElement('button', {
      type: 'button',
      onClick: () => onJog(axis, distance),
      title: tooltip,
      style: jogCellStyle,
    }, label);

  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 4 },
  },
    React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'Jog'),
    React.createElement('div', {
      style: { display: 'grid', gridTemplateColumns: '38px 38px 38px', gap: 3 },
    },
      React.createElement('div', { key: 'j0' }),
      jogCell('↑', 'Y', jogStep, 'Jog Y+'),
      React.createElement('div', { key: 'j1' }),
      jogCell('←', 'X', -jogStep, 'Jog X-'),
      React.createElement('button', {
        type: 'button',
        onClick: () => { onHome(); },
        title: 'Home machine ($H)',
        style: { ...jogCellStyle, background: 'rgba(255,212,68,0.06)', fontSize: 14 },
      }, '⌂'),
      jogCell('→', 'X', jogStep, 'Jog X+'),
      React.createElement('div', { key: 'j2' }),
      jogCell('↓', 'Y', -jogStep, 'Jog Y-'),
      React.createElement('div', { key: 'j3' }),
    ),
    React.createElement('div', {
      style: { display: 'flex', gap: 2, marginTop: 4 },
    },
      ...[0.1, 1, 10, 50].map(j =>
        React.createElement('button', {
          type: 'button',
          key: j,
          onClick: () => setJogStep(j),
          style: {
            padding: '2px 7px', fontSize: 9, borderRadius: 3, cursor: 'pointer',
            fontFamily: mono,
            background: jogStep === j ? 'rgba(0,212,255,0.1)' : 'transparent',
            border: jogStep === j ? '1px solid #00d4ff' : '1px solid #1a1a2e',
            color: jogStep === j ? '#00d4ff' : '#555570',
          },
        }, `${j}`),
      ),
    ),
  );
}
