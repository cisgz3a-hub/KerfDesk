// Audit 25-P2-1: the box dialogs size every dogbone for the active bit (F-K3),
// so the inserted operations must cut with that bit even where the 4040's
// machine starter would pin its own 1/8" cutter (ADR-106 Amendment 1).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bitReachesSeatCorners } from '../../__fixtures__/property/box-benchmark-support';
import { generateBox, generateFitCoupon, type BoxPanel, type BoxSpec } from '../../core/box';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { activeCncTool, layerCncTool, type CncMachineConfig, type Layer } from '../../core/scene';
import { useStore } from './store';
import { runCncPreflight } from '../../core/preflight/cnc-preflight';
import { COMPILE_INTEGRITY_PREFLIGHT_CODES } from '../../core/preflight';
import { cutFreshCncOperationsWithActiveBit } from './box-insert-mutation';
import { resetStore } from './test-helpers';

const SPEC: BoxSpec = {
  widthMm: 100,
  depthMm: 80,
  heightMm: 50,
  dimensionMode: 'inner',
  thicknessMm: 6,
  targetFingerWidthMm: 18,
  style: 'closed',
  clearanceMm: 0.15,
  relief: { kind: 'none' },
  partSpacingMm: 12,
  dividersXCount: 1,
};

function cncMachine(): CncMachineConfig {
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected a CNC machine');
  return machine;
}

function select4040WithActiveBit(toolId: string): void {
  useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
  useStore.getState().setMachineKind('cnc');
  useStore.getState().updateCncMachine({ toolId });
  // The starter path is the trigger: no project stock material.
  expect(cncMachine().stock.materialKey).toBeUndefined();
}

function panelsOf(spec: BoxSpec): ReadonlyArray<BoxPanel> {
  const result = generateBox(spec);
  if (result.kind !== 'generated') throw new Error(JSON.stringify(result));
  return result.panels;
}

type InsertedBox = {
  readonly nominal: ReadonlyArray<BoxPanel>;
  readonly relieved: ReadonlyArray<BoxPanel>;
  readonly bitMm: number;
};

// What BoxGeneratorHost does: relief sized for the active bit, one insert.
function insertBoxForActiveBit(): InsertedBox {
  const bitMm = activeCncTool(cncMachine()).diameterMm;
  const relieved = panelsOf({
    ...SPEC,
    relief: { kind: 'corner-overcut', toolDiameterMm: bitMm },
  });
  useStore.getState().insertBoxPanels(relieved, { thicknessMm: SPEC.thicknessMm });
  return { nominal: panelsOf(SPEC), relieved, bitMm };
}

function operation(name: string): Layer {
  const found = useStore.getState().project.scene.layers.find((layer) => layer.name === name);
  if (found === undefined) throw new Error(`no ${name} operation`);
  return found;
}

function cuttingBitMm(name: string): number {
  return layerCncTool(cncMachine(), operation(name).cnc ?? {}).diameterMm;
}

beforeEach(resetStore);
afterEach(resetStore);

describe('box operations cut with the bit their reliefs were sized for', () => {
  it('cuts with a 1/16" active bit on the 4040, so every seat corner is reached', () => {
    select4040WithActiveBit('em-1588');
    const { nominal, relieved, bitMm } = insertBoxForActiveBit();
    expect(bitMm).toBeCloseTo(1.588, 3);

    for (const name of ['Box panels', 'Box slots']) {
      expect(operation(name).cnc?.toolId).toBeUndefined();
      expect(cuttingBitMm(name)).toBe(bitMm);
      // Retained starter values keep their original provenance for review.
      expect(operation(name).cnc).toMatchObject({ feedMmPerMin: 300, depthPerPassMm: 0.75 });
      expect(operation(name).cnc?.feedSource).toMatchObject({ kind: 'machine-starter' });
    }
    const panelBitMm = cuttingBitMm('Box panels');
    const unreached = relieved.filter((panel, index) => {
      const plain = nominal[index];
      return plain === undefined || !bitReachesSeatCorners(plain, panel, panelBitMm);
    });
    expect(unreached.map((panel) => panel.name)).toEqual([]);
  });

  it('keeps the active bit after a machine-setup refresh', () => {
    select4040WithActiveBit('em-1588');
    insertBoxForActiveBit();

    useStore.getState().updateCncMachine({ stock: { thicknessMm: 7 } });

    expect(cuttingBitMm('Box panels')).toBeCloseTo(1.588, 3);
    expect(cuttingBitMm('Box slots')).toBeCloseTo(1.588, 3);
  });

  it('discloses inherited starter values for the active bit, including after setup refresh', () => {
    select4040WithActiveBit('em-1588');
    insertBoxForActiveBit();
    useStore.getState().updateCncMachine({ stock: { thicknessMm: 7 } });
    const result = runCncPreflight(
      useStore.getState().project,
      cncMachine(),
      'G21\nG90\nG1 X1 F300',
      { sourceGeometryChecks: 'compiled-evidence-only' },
    );
    const warnings = result.issues.filter(
      (issue) => issue.code === 'cnc-starter-tool-feed-retained',
    );
    expect(warnings).toHaveLength(2);
    for (const warning of warnings) {
      expect(warning.message).toContain('3.175 mm');
      expect(warning.message).toContain('1.588 mm');
      expect(warning.message).toContain('300 mm/min');
      expect(warning.message).toContain('0.75 mm/pass');
      expect(COMPILE_INTEGRITY_PREFLIGHT_CODES.has(warning.code)).toBe(false);
    }
    expect(cuttingBitMm('Box panels')).toBeCloseTo(1.588, 3);
  });

  it('recalculates an explicit material recipe for the active cutter instead of retaining the other bit values', () => {
    select4040WithActiveBit('em-1588');
    insertBoxForActiveBit();
    const project = useStore.getState().project;
    const existing = operation('Box panels');
    const layer = {
      ...existing,
      cnc: {
        ...existing.cnc!,
        toolId: 'em-3175',
        feedMmPerMin: 777,
        depthPerPassMm: 2,
        feedSource: { kind: 'material-recipe' as const, materialKey: 'aluminum', fluteCount: 3 },
      },
    };
    const result = cutFreshCncOperationsWithActiveBit([], {
      project: { ...project, scene: { ...project.scene, layers: [layer] } },
    });
    const settings = result.project.scene.layers[0]?.cnc;
    expect(settings?.toolId).toBeUndefined();
    // ADR-233 Amd 2: the 1/16" bit takes the interpolated aluminium chip load
    // (0.0105 mm/tooth: F250 at 12,000 RPM), not the 1/8" band capped to F300.
    expect(settings).toMatchObject({
      feedMmPerMin: 250,
      plungeMmPerMin: 40,
      depthPerPassMm: 0.2,
      feedSource: { kind: 'material-recipe', materialKey: 'aluminum', fluteCount: 2 },
    });
  });

  it('keeps the full starter seeding when the starter bit is the active bit', () => {
    select4040WithActiveBit('em-3175');
    insertBoxForActiveBit();

    expect(operation('Box panels').cnc).toMatchObject({
      toolId: 'em-3175',
      feedMmPerMin: 300,
      feedSource: { kind: 'machine-starter' },
    });
    const result = runCncPreflight(
      useStore.getState().project,
      cncMachine(),
      'G21\nG90\nG1 X1 F300',
      { sourceGeometryChecks: 'compiled-evidence-only' },
    );
    expect(result.issues.some((issue) => issue.code === 'cnc-starter-tool-feed-retained')).toBe(
      false,
    );
  });

  it('gives Box Fit Test strips the same bit', () => {
    select4040WithActiveBit('em-1588');
    const fit = generateFitCoupon({
      thicknessMm: 6,
      fingerWidthMm: 18,
      startClearanceMm: 0,
      stepClearanceMm: 0.05,
      rungCount: 4,
      relief: { kind: 'corner-overcut', toolDiameterMm: 1.588 },
    });
    if (fit.kind !== 'generated') throw new Error(JSON.stringify(fit));
    useStore.getState().insertBoxPanels(
      fit.parts.map((part) => ({
        name: part.name,
        outline: part.rings.outline,
        cutouts: part.rings.cutouts,
      })),
      { thicknessMm: 6 },
    );

    expect(cuttingBitMm('Box panels')).toBeCloseTo(1.588, 3);
  });
});
