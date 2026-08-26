import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
} from '../../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../../core/scene';
import { buildMachineReviewFacts } from './job-review-live-rows';

describe('Job Review machine facts', () => {
  it('discloses the uncapped requested Frame feed when live axis limits are unknown', () => {
    const facts = buildMachineReviewFacts(
      createProject({
        ...DEFAULT_DEVICE_PROFILE,
        maxFeed: 1000,
        framingFeedMmPerMin: 5000,
      }),
      null,
    );

    expect(facts).toContainEqual({
      label: 'Frame feed',
      value: 'requested 5000 · effective XY 5000 mm/min · live X unknown, Y unknown',
      tone: 'warning',
    });
  });

  it('discloses the slower known live axis as the effective Frame feed', () => {
    const facts = buildMachineReviewFacts(createProject(DEFAULT_DEVICE_PROFILE), {
      maxFeedX: 1500,
      maxFeedY: 1000,
    });

    expect(facts).toContainEqual({
      label: 'Frame feed',
      value: 'requested 6000 · effective XY 1000 mm/min · live X 1500 mm/min, Y 1000 mm/min',
      tone: 'warning',
    });
  });

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

  it('warns when a legacy scan-offset table has no recorded provenance', () => {
    const facts = buildMachineReviewFacts(
      createProject({
        ...DEFAULT_DEVICE_PROFILE,
        scanningOffsets: [{ speedMmPerMin: 2000, offsetMm: 0.1 }],
        scanOffsetCalibrationStatus: undefined,
      }),
    );

    expect(facts).toContainEqual({
      label: 'Scan offsets',
      value: '1 legacy/statusless point(s) · source and verification not recorded',
      tone: 'warning',
    });
  });

  it('warns on pending scan offsets without disabling the table', () => {
    const facts = buildMachineReviewFacts(
      createProject({
        ...DEFAULT_DEVICE_PROFILE,
        scanningOffsets: [{ speedMmPerMin: 2000, offsetMm: 0.1 }],
        scanOffsetCalibrationStatus: 'pending',
      }),
    );

    expect(facts).toContainEqual({
      label: 'Scan offsets',
      value: '1 point(s) · verification pending; table remains available',
      tone: 'warning',
    });
  });

  it('states the powered-Z assumption and informational travel in CNC review', () => {
    const project = {
      ...createProject({ ...DEFAULT_DEVICE_PROFILE, zTravelMm: 75 }),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    };

    expect(buildMachineReviewFacts(project)).toContainEqual({
      label: 'Powered Z assumption',
      value: 'CNC assumes installed powered Z · 75 mm recorded (informational, not hardware proof)',
      tone: 'warning',
    });
  });
});
