import React from 'react';

interface JobControlsProps {
  isConnected: boolean;
  isRunning: boolean;
  displayPaused: boolean;
  jobProgressSection: React.ReactNode;
  footerSection: React.ReactNode;
}

export function JobControls({
  isConnected,
  isRunning,
  displayPaused,
  jobProgressSection,
  footerSection,
}: JobControlsProps) {
  if (!isConnected) return null;
  return React.createElement(
    React.Fragment,
    null,
    (isRunning || displayPaused) && jobProgressSection,
    footerSection,
  );
}
