import React from 'react';

interface ConnectionControlsProps {
  statusSection: React.ReactNode;
  connectSection: React.ReactNode;
  isConnected: boolean;
}

export function ConnectionControls({
  statusSection,
  connectSection,
  isConnected,
}: ConnectionControlsProps) {
  return React.createElement(
    React.Fragment,
    null,
    statusSection,
    !isConnected && connectSection,
  );
}
