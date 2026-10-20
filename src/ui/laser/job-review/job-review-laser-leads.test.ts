import { describe, expect, it } from 'vitest';
import { createLayer } from '../../../core/scene';
import { laserOperationDetail } from './job-review-detail-facts';

const baseLayer = createLayer({ id: 'a', color: '#ff0000' });

describe('Job Review lead facts', () => {
  it('names the leads a line operation asks for, and nothing while they are off (ADR-626)', () => {
    expect(laserOperationDetail({ ...baseLayer, leadStyle: 'line' })).not.toContain('lead');
    expect(
      laserOperationDetail({ ...baseLayer, leadInEnabled: true, leadOutEnabled: true }),
    ).toContain('lead-in and lead-out arc 2 mm at 90°, in the scrap');
    expect(
      laserOperationDetail({
        ...baseLayer,
        leadOutEnabled: true,
        leadStyle: 'line',
        leadLengthMm: 1.5,
        leadSide: 'inside',
      }),
    ).toContain('lead-out line 1.5 mm at 45°, always inside');
  });
});
