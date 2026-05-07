import React from 'react';

interface MoveControlsProps {
  isConnected: boolean;
  isRunning: boolean;
  displayPaused: boolean;
  workflowSection: React.ReactNode;
  layerOverviewSection: React.ReactNode;
  gcodeWarning: React.ReactNode;
  compileProgressSection: React.ReactNode;
  issuesSection: React.ReactNode;
  outcomeExtrasSection: React.ReactNode;
}

export function MoveControls(props: MoveControlsProps) {
  const {
    isConnected,
    isRunning,
    displayPaused,
    workflowSection,
    layerOverviewSection,
    gcodeWarning,
    compileProgressSection,
    issuesSection,
    outcomeExtrasSection,
  } = props;
  if (!isConnected) return null;
  return React.createElement(
    React.Fragment,
    null,
    !isRunning && !displayPaused && workflowSection,
    layerOverviewSection,
    gcodeWarning,
    compileProgressSection,
    issuesSection,
    outcomeExtrasSection,
  );
}
