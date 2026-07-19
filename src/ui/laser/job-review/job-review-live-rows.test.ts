import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
} from '../../../core/devices';
import { createProject } from '../../../core/scene';
import { buildMachineReviewFacts } from './job-review-live-rows';

describe('Job Review machine facts', () => {
  it('labels the 4040 pump as manual when no controller M-code is configured', () => {
    const facts = buildMachineReviewFacts(createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE));

    expect(facts).toContainEqual({
      label: 'Air assist command',
      value: 'Manual/external (no M-code)',
      tone: 'default',
    });
  });

  it('shows an explicitly configured relay command instead', () => {
    const facts = buildMachineReviewFacts(
      createProject({ ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' }),
    );

    expect(facts).toContainEqual({
      label: 'Air assist command',
      value: 'M8',
      tone: 'default',
    });
  });
});
