import type { CSSProperties } from 'react';

// Backdrop/panel/heading/action chrome comes from the kit Dialog shell
// (ADR-047); only the two-column field grid remains calibration-specific.
export const calibrationGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 8,
};

// Each field spans two rows of the dialog's grid: every label in a row shares
// the first and every box the second, so a long label that wraps ("Material
// thickness (mm)") moves neither the other labels nor any box.
export const calibrationFieldStyle: CSSProperties = {
  display: 'grid',
  gridRow: 'span 2',
  gridTemplateRows: 'subgrid',
  alignItems: 'start',
  rowGap: 3,
  fontSize: 12,
};
