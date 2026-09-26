import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
} from '../../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../../core/scene';
import {
  buildControllerReviewFacts,
  buildMachineReviewFacts,
  controllerReviewSummary,
  type ControllerReviewArgs,
} from './job-review-live-rows';

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

  it('leaves the laser dialect and scan-offset rows out of CNC review', () => {
    const project = {
      ...createProject({
        ...DEFAULT_DEVICE_PROFILE,
        scanningOffsets: [{ speedMmPerMin: 3000, offsetMm: 0.1 }],
        scanOffsetCalibrationStatus: 'pending',
      }),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    };
    const labels = buildMachineReviewFacts(project).map((row) => row.label);
    expect(labels).not.toContain('Scan offsets');
    expect(labels).not.toContain('G-code dialect');
    const laserLabels = buildMachineReviewFacts(createProject()).map((row) => row.label);
    expect(laserLabels).toEqual(expect.arrayContaining(['Scan offsets', 'G-code dialect']));
  });

  // ADR-392 Amendment 1: an unset park used to read "Machine origin", which is
  // wrong for every placed job: they end at program X0 Y0 or their own start.
  it('labels a set park as a bed position and an unset one by where the job ends', () => {
    const cnc = (park: { readonly parkXMm?: number; readonly parkYMm?: number }) => ({
      ...createProject(DEFAULT_DEVICE_PROFILE),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, ...park },
      },
    });
    const parkFact = (
      project: ReturnType<typeof cnc>,
      startFrom?: Parameters<typeof buildMachineReviewFacts>[2],
    ) =>
      buildMachineReviewFacts(project, null, startFrom).find((f) => f.label === 'Park after job');

    expect(parkFact(cnc({ parkXMm: 0, parkYMm: 200 }), 'user-origin')?.value).toBe(
      'Bed X 0 · Y 200',
    );
    expect(parkFact(cnc({ parkYMm: 380 }), 'absolute')?.value).toBe('Bed X 0 · Y 380');
    expect(parkFact(cnc({}), 'current-position')?.value).toBe(
      'Not set · back to where the job started',
    );
    expect(parkFact(cnc({}), 'user-origin')?.value).toBe('Not set · program X0 Y0');
    expect(parkFact(cnc({}), 'absolute')?.value).toBe('Not set · program X0 Y0');
    expect(parkFact(cnc({}))?.value).toBe(
      'Not set · program X0 Y0, or a Current Position job start',
    );
  });
});

describe('Job Review override facts (ADR-355)', () => {
  const leftover = { feed: 60, rapid: 100, spindle: 80 };
  const reviewArgs = (
    machineKind: 'laser' | 'cnc',
    overrides: { feed: number; rapid: number; spindle: number } | null,
  ): ControllerReviewArgs => ({
    isConnected: true,
    machineKind,
    statusReport: null,
    alarmCode: null,
    activeControllerKind: 'grblhal',
    detectedControllerKind: null,
    controllerSettings: null,
    activeWcs: null,
    overrides,
    profileMaxPowerS: 1000,
    profileBedWidth: 400,
    profileBedHeight: 400,
  });

  it('tells a laser operator their leftover overrides reset at Start', () => {
    const args = reviewArgs('laser', leftover);

    expect(controllerReviewSummary(args)).toBe('no status yet · overrides reset to 100% at Start');
    expect(buildControllerReviewFacts(args)).toContainEqual({
      label: 'Overrides',
      value: 'Feed 60% · Rapid 100% · Spindle 80% — reset to 100% when this job starts',
      tone: 'warning',
    });
  });

  it('keeps flagging CNC overrides without promising a reset', () => {
    const args = reviewArgs('cnc', leftover);

    expect(controllerReviewSummary(args)).toBe('no status yet · overrides active');
    expect(buildControllerReviewFacts(args)).toContainEqual({
      label: 'Overrides',
      value: 'Feed 60% · Rapid 100% · Spindle 80%',
      tone: 'warning',
    });
  });

  it('says nothing extra when the overrides are already at 100%', () => {
    const args = reviewArgs('laser', { feed: 100, rapid: 100, spindle: 100 });

    expect(controllerReviewSummary(args)).toBe('no status yet');
  });
});
