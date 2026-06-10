import type { CSSProperties } from 'react';

// Backdrop/panel/heading/action chrome comes from the kit Dialog shell
// (ADR-047); only the two-column field grid remains calibration-specific.
export const calibrationGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 8,
};
