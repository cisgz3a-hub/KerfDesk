// Pins "one term per concept" for the no-recipe state across the sole Startup
// authoring flow and its read-only Artwork / Job Review representations.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANUAL_FEEDS_LABEL } from './cnc-material-vocabulary';

const SURFACES = [
  'src/ui/laser/device-setup/DeviceSetupCncJobStep.tsx',
  'src/ui/laser/device-setup/DeviceSetupCncToolPlan.tsx',
  'src/ui/laser/device-setup/DeviceSetupCncReview.tsx',
  'src/ui/layers/CncSetupReferenceFields.tsx',
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
