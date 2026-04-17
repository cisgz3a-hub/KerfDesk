import React from 'react';

interface ConnectionControlsProps {
  statusSection: React.ReactNode;
  alarmBanner?: React.ReactNode;
  connectSection: React.ReactNode;
  isConnected: boolean;
}

export function ConnectionControls({
  statusSection,
  alarmBanner,
  connectSection,
  isConnected,
}: ConnectionControlsProps) {
  return React.createElement(
    React.Fragment,
    null,
    statusSection,
    alarmBanner,
    !isConnected && connectSection,
  );
}
