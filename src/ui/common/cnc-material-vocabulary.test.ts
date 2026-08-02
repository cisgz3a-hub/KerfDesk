// Pins "one term per concept" for the no-recipe state. Three surfaces render
// it — the layer card's Material row, the project material picker, and the Job
// Review stock card — and they drifted into two different names. A future edit
// that reintroduces a second wording fails here rather than in front of an
// operator comparing two panels.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANUAL_FEEDS_LABEL } from './cnc-material-vocabulary';

const SURFACES = [
  'src/ui/layers/CncMaterialRow.tsx',
  'src/ui/machine/CncProjectMaterialPicker.tsx',
  'src/ui/laser/job-review/JobReviewStockCard.tsx',
];

// The wording this replaced. Left as a literal so re-adding it is caught.
const RETIRED_WORDING = 'Custom (manual feeds)';

describe('manual-feeds vocabulary', () => {
  it('names the no-recipe state the same way on every surface', () => {
    for (const path of SURFACES) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain('MANUAL_FEEDS_LABEL');
      expect(source).not.toContain(RETIRED_WORDING);
    }
  });

  it('states what the operator must do, not merely that a preset is absent', () => {
    expect(MANUAL_FEEDS_LABEL).toContain('Manual');
    expect(MANUAL_FEEDS_LABEL).toContain('verify');
  });
});
