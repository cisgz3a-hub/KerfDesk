import React from 'react';
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
  if (!isConnected) return null;
  return React.createElement(
    React.Fragment,
    null,
    moreSection,
    simulatorView,
    React.createElement(ConsoleInput, { controller, isConnected, isRunning, sendUserCommand }),
  );
}
