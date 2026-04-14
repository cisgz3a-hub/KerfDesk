import React from 'react';

interface ConsolePanelProps {
  isConnected: boolean;
  moreSection: React.ReactNode;
  simulatorView: React.ReactNode;
}

export function ConsolePanel({
  isConnected,
  moreSection,
  simulatorView,
}: ConsolePanelProps) {
  if (!isConnected) return null;
  return React.createElement(React.Fragment, null, moreSection, simulatorView);
}
