import React from 'react';
import { ConsoleInput } from './ConsoleInput';
import { type LaserController } from '../../controllers/ControllerInterface';

interface ConsolePanelProps {
  isConnected: boolean;
  isRunning: boolean;
  controller: LaserController | null;
  sendUserCommand: (cmd: string) => void | Promise<void>;
  advancedSection: React.ReactNode;
  simulatorView: React.ReactNode;
}

export function ConsolePanel({
  isConnected,
  isRunning,
  controller,
  sendUserCommand,
  advancedSection,
  simulatorView,
}: ConsolePanelProps) {
  if (!isConnected) return null;
  return React.createElement(
    'section',
    {
      'data-testid': 'connection-advanced-details-body',
      style: {
        minHeight: 0,
        flexShrink: 0,
      },
    },
    advancedSection,
    simulatorView,
    React.createElement(ConsoleInput, { controller, isConnected, isRunning, sendUserCommand }),
  );
}
