import React from 'react';

interface MoveControlsProps {
  isConnected: boolean;
  layerOverviewSection: React.ReactNode;
  gcodeWarning: React.ReactNode;
  compileProgressSection: React.ReactNode;
  outcomeExtrasSection: React.ReactNode;
}

export function MoveControls(props: MoveControlsProps) {
  const {
    isConnected,
    layerOverviewSection,
    gcodeWarning,
    compileProgressSection,
    outcomeExtrasSection,
  } = props;
  if (!isConnected) return null;
  return React.createElement(
    React.Fragment,
    null,
    layerOverviewSection,
    gcodeWarning,
    compileProgressSection,
    outcomeExtrasSection,
  );
}
