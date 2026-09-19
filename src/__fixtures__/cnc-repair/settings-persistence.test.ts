import { describe, expect, it } from 'vitest';
import { CNC_CUT_TYPES, type CncLayerSettings, type CncMachineConfig } from '../../core/scene';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import {
  layerWith,
  machine,
  onlyGroup,
  profile,
  projectFor,
  roundTrip,
  settingsFor,
  twoMmTool,
} from './settings-fixtures';

describe('Independent CNC settings persistence and output controls', () => {
  it('round-trips every operation field, including dormant settings, for all eight editable cut types', () => {
    const allSettings: CncLayerSettings = {
      cutType: 'profile-on-path',
      toolId: twoMmTool.id,
      vClearToolId: twoMmTool.id,
      reliefFinishToolId: twoMmTool.id,
      reliefScallopMm: 0.017,
      rampEntryDeg: 2.7,
      vCarveRampEntryDeg: 4.1,
      vCarveFlatDepthEnabled: false,
      helixEntry: { minDiameterMm: 2.1, maxDiameterMm: 7.9, angleDeg: 3.2 },
      pocketRoughToolId: twoMmTool.id,
      cutDirection: 'conventional',
      depthMm: 0.02,
      depthPerPassMm: 0.01,
      vResolutionMm: 0.07,
      inlayPocketDepthMm: 2.75,
      inlayAllowanceMm: 0.13,
      inlayPairSpacingMm: 17.25,
      feedMmPerMin: 987.654321,
      plungeMmPerMin: 234.56789,
      spindleRpm: 5432.1,
      stepoverPercent: 17.25,
      pocketStrategy: 'raster-y',
      adaptiveOptimalLoadMm: 0.19,
      materialKey: 'hardwood-oak',
      feedSource: { kind: 'material-recipe', materialKey: 'hardwood-oak', fluteCount: 4 },
      tabsEnabled: false,
      tabHeightMm: 0.02,
      tabWidthMm: 0.2,
      tabsPerShape: 23,
      finishAllowanceMm: 0.125,
      lineArtContours: 'both',
      profileLead: { shape: 'arc', radiusMm: 2.75, sweepDeg: 64.5 },
      retractBetweenPasses: false,
    };
    const cncMachine: CncMachineConfig = {
      ...machine,
      tools: [
        {
          ...twoMmTool,
          kind: 'engraving',
          tipAngleDeg: 60,
          tipDiameterMm: 0.2,
          family: 'fixture-engraver',
          shankDiameterMm: 3.175,
          fluteCount: 23,
          catalogId: 'fixture-catalog',
        },
      ],
      stock: {
        widthMm: 350,
        heightMm: 290,
        thicknessMm: 9.25,
        originOffset: { x: -7.5, y: 2.75 },
        materialKey: 'hardwood-oak',
      },
      params: {
        safeZMm: 1.25,
        spindleMaxRpm: 24000,
        spindleSpinupSec: 1.5,
        coolant: 'mist',
        parkXMm: 7.5,
        parkYMm: -6.25,
      },
      tiling: { tileWidthMm: 120.5, tileHeightMm: 90.25, overlapMm: 7.5, registrationHoles: false },
    };
    expect(CNC_CUT_TYPES).toHaveLength(8);
    for (const cutType of CNC_CUT_TYPES) {
      const settings = { ...allSettings, cutType };
      const project = projectFor(layerWith(settings), cncMachine);
      expect(prepareProjectForPersistence(project).kind).toBe('ok');
      const reopened = roundTrip(project);
      expect(settingsFor(reopened)).toEqual(settings);
      expect(reopened.machine).toEqual(cncMachine);
    }
  });

  it('cuts the analytic source centerline at exactly 1 mm with the default operation', () => {
    const group = onlyGroup(roundTrip(projectFor(layerWith())));
    expect(group.cutType).toBe('profile-on-path');
    expect(group.passes).toHaveLength(1);
    const pass = group.passes[0];
    if (pass?.kind !== 'contour') throw new Error('Expected one contour');
    expect(pass.zMm).toBe(-1);
    expect(Math.min(...pass.polyline.map((point) => point.x))).toBe(50);
    expect(Math.max(...pass.polyline.map((point) => point.x))).toBe(60);
    expect(Math.min(...pass.polyline.map((point) => point.y))).toBe(profile.bedHeight - 56);
    expect(Math.max(...pass.polyline.map((point) => point.y))).toBe(profile.bedHeight - 50);
    expect(group).toMatchObject({ feedMmPerMin: 1000, plungeMmPerMin: 300, spindleRpm: 12000 });
  });

  it('leaves dormant specialist settings inert on an ordinary stepped-depth on-path job', () => {
    const baseline = projectFor(
      layerWith({
        depthMm: 2.7,
        depthPerPassMm: 1.1,
        feedMmPerMin: 765.4321,
        plungeMmPerMin: 234.5678,
      }),
    );
    const variant = projectFor(
      layerWith({
        ...settingsFor(baseline),
        vClearToolId: twoMmTool.id,
        reliefFinishToolId: twoMmTool.id,
        reliefScallopMm: 0.01,
        vCarveFlatDepthEnabled: true,
        vCarveRampEntryDeg: 15,
        vResolutionMm: 0.0001,
        helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 4 },
        pocketRoughToolId: twoMmTool.id,
        inlayPocketDepthMm: 5,
        inlayAllowanceMm: 0.75,
        inlayPairSpacingMm: 5,
        stepoverPercent: 12,
        pocketStrategy: 'adaptive',
        adaptiveOptimalLoadMm: 0.25,
        finishAllowanceMm: 3,
        materialKey: 'hardwood',
      }),
    );
    const group = onlyGroup(roundTrip(variant));
    expect(group.passes).toEqual(onlyGroup(baseline).passes);
    expect(group.feedMmPerMin).toBe(765.4321);
    expect(group.plungeMmPerMin).toBe(234.5678);
    expect(group.passes.map((pass) => (pass.kind === 'contour' ? pass.zMm : null))).toEqual([
      -1.1, -2.2, -2.7,
    ]);
  });
});
