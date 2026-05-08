import React, { useState } from 'react';
import { ConsoleInput } from './ConsoleInput';
import { type LaserController } from '../../controllers/ControllerInterface';

interface ConsolePanelProps {
  isConnected: boolean;
  isRunning: boolean;
  controller: LaserController | null;
  sendUserCommand: (cmd: string) => void | Promise<void>;
  moreSection: React.ReactNode;
  simulatorView: React.ReactNode;
}

export function ConsolePanel({
  isConnected,
  isRunning,
  controller,
  sendUserCommand,
  moreSection,
  simulatorView,
}: ConsolePanelProps) {
  const [expanded, setExpanded] = useState(false);
  if (!isConnected) return null;
  return React.createElement(
    'section',
    {
      style: {
        borderTop: '1px solid #1a1a2e',
        flexShrink: 0,
      },
    },
    React.createElement('button', {
      type: 'button',
      onClick: () => setExpanded(v => !v),
      'aria-expanded': expanded,
      style: {
        width: '100%',
        padding: '9px 16px',
        background: '#0d0d18',
        border: 'none',
        color: '#8888aa',
        cursor: 'pointer',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontSize: 11,
        fontWeight: 700,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      },
    },
      React.createElement('span', null, 'Advanced machine details'),
      React.createElement('span', { style: { color: '#555570' } }, expanded ? 'Hide' : 'Show'),
    ),
    expanded && React.createElement(React.Fragment, null,
      moreSection,
      simulatorView,
      React.createElement(ConsoleInput, { controller, isConnected, isRunning, sendUserCommand }),
    ),
  );
}
