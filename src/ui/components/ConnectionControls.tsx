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
  /**
   * Laser-mode ($32=0) detection banner. Independent of alarm/
   * faulted state — orthogonality of underlying conditions.
   * LaserModeBanner returns null when not applicable.
   */
  laserModeBanner?: React.ReactNode;
  connectSection: React.ReactNode;
  isConnected: boolean;
}

export function ConnectionControls({
  statusSection,
  alarmBanner,
  faultedBanner,
  laserModeBanner,
  connectSection,
  isConnected,
}: ConnectionControlsProps) {
  return React.createElement(
    React.Fragment,
    null,
    statusSection,
    alarmBanner,
    faultedBanner,
    laserModeBanner,
    !isConnected && connectSection,
  );
}
