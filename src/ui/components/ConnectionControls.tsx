import React from 'react';

interface ConnectionControlsProps {
  statusSection: React.ReactNode;
  alarmBanner?: React.ReactNode;
  /**
   * T2-12 part 2: rendered next to alarmBanner. Mutual exclusion is
   * guaranteed by the controller's status field — at most one of
   * alarm / faulted_requires_inspection is true at a time.
   */
  faultedBanner?: React.ReactNode;
  connectSection: React.ReactNode;
  isConnected: boolean;
}

export function ConnectionControls({
  statusSection,
  alarmBanner,
  faultedBanner,
  connectSection,
  isConnected,
}: ConnectionControlsProps) {
  return React.createElement(
    React.Fragment,
    null,
    statusSection,
    alarmBanner,
    faultedBanner,
    !isConnected && connectSection,
  );
}
