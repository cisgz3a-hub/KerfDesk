import React from 'react';

interface StatusBarProps {
  isConnected: boolean;
  isSimulator: boolean;
  status: string | null | undefined;
  posX: number | null | undefined;
  posY: number | null | undefined;
  onClose: () => void;
}

const mono = "'JetBrains Mono', monospace";

export function StatusBar({ isConnected, isSimulator, status, posX, posY, onClose }: StatusBarProps) {
  return React.createElement('div', {
    style: {
      padding: '10px 16px', borderBottom: '1px solid #1a1a2e',
      background: isConnected ? 'rgba(45,212,160,0.04)' : '#0a0a14',
      flexShrink: 0,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    },
  },
    React.createElement('div', null,
      React.createElement('div', {
        style: { fontSize: 13, fontWeight: 600, color: isConnected ? '#2dd4a0' : '#8888aa' },
      }, isConnected ? `⚡ Connected${isSimulator ? ' (Sim)' : ''}` : '⚡ Not Connected'),
      isConnected && React.createElement('div', {
        style: { fontSize: 10, fontFamily: mono, color: '#555570', marginTop: 2 },
      },
        `${status || 'Unknown'}  ·  X:${posX != null && Number.isFinite(posX) ? posX.toFixed(1) : '?'}  Y:${posY != null && Number.isFinite(posY) ? posY.toFixed(1) : '?'}`,
      ),
    ),
    React.createElement('button', {
      type: 'button',
      onClick: onClose,
      style: { background: 'none', border: 'none', color: '#555570', fontSize: 16, cursor: 'pointer', padding: '0 4px' },
    }, '×'),
  );
}
