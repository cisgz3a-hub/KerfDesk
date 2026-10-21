import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createLayerSubLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  type Layer,
  type TracedImage,
} from '../../core/scene';
import {
  ArtworkPulseClock,
  pulseColorSources,
  PULSE_DURATION_MS,
  PULSE_EDGE_ALPHA,
  PULSE_PEAK_STRENGTH,
  pulseGlowAlpha,
  pulseStartOffsets,
  pulseStrength,
  pulseTargetFor,
  PulseTrigger,
  type PulseTarget,
} from './artwork-pulse';
import { sameOperationSettings } from './pulse-settings-match';

function layer(id: string, color: string, overrides: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id, color }), ...overrides };
}

function artwork(id: string, operationId: string, x: number): TracedImage {
  return {
    kind: 'traced-image',
    id,
    source: `${id}.png`,
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x },
    operationIds: [operationId],
    paths: [{ color: '#000000', polylines: [] }],
  };
}

describe('pulse shape', () => {
  it('swells gently to a soft tint, never full colour, then ebbs back to ink', () => {
    expect(pulseStrength(0)).toBe(0);
    // An eased start: no flash in the first frames.
    expect(pulseStrength(0.04)).toBeLessThan(0.1);
    expect(pulseStrength(0.17)).toBeGreaterThan(pulseStrength(0.08));
    const samples = Array.from({ length: 101 }, (_, index) => pulseStrength(index / 100));
    expect(Math.max(...samples)).toBeCloseTo(PULSE_PEAK_STRENGTH, 2);
    expect(PULSE_PEAK_STRENGTH).toBeLessThan(1);
    // No flat hold: the peak is a moment, and the ebb is longer than the swell.
    expect(samples.filter((value) => value > 0.99 * PULSE_PEAK_STRENGTH).length).toBeLessThan(10);
    expect(pulseStrength(0.6)).toBeGreaterThan(pulseStrength(0.8));
    expect(pulseStrength(1)).toBe(0);
    expect(pulseStrength(-0.1)).toBe(0);
  });

  it('breathes a faint halo with the colour', () => {
    const start = pulseGlowAlpha(0.02);
    const peak = pulseGlowAlpha(0.34);
    const late = pulseGlowAlpha(0.8);
    expect(start).toBeLessThan(peak);
    expect(late).toBeLessThan(peak);
    expect(peak).toBeLessThan(0.4);
    expect(pulseGlowAlpha(0)).toBe(0);
    expect(pulseGlowAlpha(1)).toBe(0);
  });
});

describe('which artwork pulses together', () => {
  const engrave = layer('engrave', '#2563eb', { power: 40, speed: 3000 });
  const sameEngrave = layer('engrave-2', '#16a34a', { power: 40, speed: 3000, name: 'Other' });
  const cut = layer('cut', '#dc2626', { power: 100, speed: 480 });

  it('groups operations by settings in the colour of the one pointed at', () => {
    const group = pulseColorSources([engrave, sameEngrave, cut], ['engrave'], 'laser');
    // Name and colour do not count; the whole group pulses in the seed's colour.
    expect([...group]).toEqual([
      ['engrave', 'engrave'],
      ['engrave-2', 'engrave'],
    ]);
    expect([...pulseColorSources([engrave, cut], ['cut'], 'laser')]).toEqual([['cut', 'cut']]);
  });

  it('keeps each seed its own colour when the pointer is on artwork with two operations', () => {
    const group = pulseColorSources([engrave, sameEngrave, cut], ['cut', 'engrave-2'], 'laser');
    expect(group.get('cut')).toBe('cut');
    expect(group.get('engrave-2')).toBe('engrave-2');
    expect(group.get('engrave')).toBe('engrave-2');
  });

  it('groups equal sub-operations independently of their ids and labels', () => {
    const a = {
      ...engrave,
      subLayers: [createLayerSubLayer(cut, { id: 'first-cut', label: 'Outline' })],
    };
    const b = {
      ...sameEngrave,
      subLayers: [createLayerSubLayer(cut, { id: 'second-cut', label: 'Finish' })],
    };
    expect([...pulseColorSources([a, b], [a.id], 'laser').keys()]).toEqual([a.id, b.id]);
    expect(sameOperationSettings(a, { ...b, subLayers: [] }, 'laser')).toBe(false);
    expect(
      sameOperationSettings(
        a,
        { ...b, subLayers: [createLayerSubLayer(cut, { id: 'cut', label: '', enabled: false })] },
        'laser',
      ),
    ).toBe(false);
    expect(
      sameOperationSettings(
        a,
        { ...b, subLayers: [createLayerSubLayer(engrave, { id: 'cut', label: '' })] },
        'laser',
      ),
    ).toBe(false);
  });

  it('groups absent laser options with their explicit legacy defaults, including sub-operations', () => {
    const explicit = {
      ...sameEngrave,
      allowUncalibratedBidirectionalScan: false,
      perforationEnabled: false,
      perforationCutMm: 3,
      perforationSkipMm: 1,
      overcutMm: 0,
      imageOverscanMm: 5,
      tabLayout: 'count' as const,
      tabSpacingMm: 50,
      tabMaxPerShape: 0,
      tabCutPowerPercent: 0,
      imageScanAngleDeg: 0,
      imageCrossHatch: false,
      passAngleStepDeg: 0,
      autoOverscan: false,
    };
    expect(sameOperationSettings(engrave, explicit, 'laser')).toBe(true);
    expect(
      sameOperationSettings(
        { ...engrave, subLayers: [createLayerSubLayer(engrave, { id: 'sub', label: '' })] },
        { ...explicit, subLayers: [createLayerSubLayer(explicit, { id: 'sub', label: '' })] },
        'laser',
      ),
    ).toBe(true);
    for (const changed of [
      { perforationEnabled: true },
      { tabLayout: 'spacing' as const },
      { autoOverscan: true },
      { imageOverscanMm: 0 },
      { imageScanAngleDeg: 45 },
      { powerMode: 'dynamic' as const },
      // Absence uses the device's calibration; explicit zero disables that offset.
      { bidirectionalScanOffsetMm: 0 },
    ]) {
      expect(sameOperationSettings(engrave, { ...explicit, ...changed }, 'laser')).toBe(false);
    }
  });

  it('treats an operation with no CNC block as the CNC defaults', () => {
    const legacy = layer('legacy', '#2563eb');
    const explicit = layer('explicit', '#dc2626', { cnc: DEFAULT_CNC_LAYER_SETTINGS });
    const deeper = layer('deeper', '#16a34a', {
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: DEFAULT_CNC_LAYER_SETTINGS.depthMm + 1 },
    });
    const group = pulseColorSources([legacy, explicit, deeper], ['legacy'], 'cnc');
    expect([...group.keys()]).toEqual(['legacy', 'explicit']);
  });

  it('compares CNC operations by their CNC settings only', () => {
    const a = layer('a', '#2563eb', { power: 10 });
    const b = layer('b', '#dc2626', { power: 90 });
    expect([...pulseColorSources([a, b], ['a'], 'cnc').keys()]).toEqual(['a', 'b']);
  });

  it('pulses every piece sharing the hovered artwork settings, rippling out from it', () => {
    const objects = [
      artwork('heart', 'engrave', 0),
      artwork('name', 'engrave-2', 100),
      artwork('box', 'cut', 200),
    ];
    const target = pulseTargetFor(
      objects,
      [engrave, sameEngrave, cut],
      'laser',
      { kind: 'object', objectId: 'heart' },
      (object) => ({ x: object.transform.x, y: 0 }),
    );
    expect(target?.objectIds).toEqual(['heart', 'name']);
    expect(target?.offsets.get('heart')).toBe(0);
    expect(target?.offsets.get('name')).toBeGreaterThan(0);
  });

  it('pulses an operation row from its operation id, and nothing for a missing one', () => {
    const objects = [artwork('box', 'cut', 0)];
    const centre = () => ({ x: 0, y: 0 });
    const seed = { kind: 'operation', operationId: 'cut' } as const;
    expect(pulseTargetFor(objects, [cut], 'laser', seed, centre)?.objectIds).toEqual(['box']);
    const gone = { kind: 'operation', operationId: 'deleted' } as const;
    expect(pulseTargetFor(objects, [cut], 'laser', gone, centre)).toBeNull();
  });

  it('sweeps left to right without an origin and keeps the whole ripple short', () => {
    const pieces = Array.from({ length: 40 }, (_, index) => ({ id: `p${index}`, x: -index, y: 0 }));
    const offsets = pulseStartOffsets(pieces, null);
    expect(offsets.get('p39')).toBe(0);
    expect(offsets.get('p0')).toBeLessThanOrEqual(560);
    expect(offsets.get('p0')).toBeGreaterThan(offsets.get('p1') ?? Infinity);
  });
});

describe('settings edit glow', () => {
  const engrave = layer('engrave', '#2563eb', { power: 40, speed: 3000 });
  const sameEngrave = layer('engrave-2', '#dc2626', { power: 40, speed: 3000 });
  const centre = (object: { readonly transform: { readonly x: number } }) => ({
    x: object.transform.x,
    y: 0,
  });

  it('lights exactly the edited artwork, not pieces that merely share its settings', () => {
    const objects = [artwork('heart', 'engrave', 0), artwork('name', 'engrave-2', 100)];
    const target = pulseTargetFor(
      objects,
      [engrave, sameEngrave],
      'laser',
      { kind: 'edit', owner: 'editor', serial: 1, objectIds: ['heart'], operationIds: ['engrave'] },
      centre,
    );
    expect(target?.objectIds).toEqual(['heart']);
    expect([...(target?.colorSources ?? [])]).toEqual([['engrave', 'engrave']]);
  });

  it('lights every piece an operation edit changes, sweeping left to right', () => {
    const objects = [artwork('right', 'engrave', 200), artwork('left', 'engrave', 0)];
    const target = pulseTargetFor(
      objects,
      [engrave],
      'laser',
      {
        kind: 'edit',
        owner: 'editor',
        serial: 1,
        objectIds: ['right', 'left'],
        operationIds: ['engrave'],
      },
      centre,
    );
    expect(target?.objectIds).toEqual(['right', 'left']);
    expect(target?.offsets.get('left')).toBe(0);
    expect(target?.offsets.get('right')).toBeGreaterThan(0);
  });

  it('lights nothing once the edited artwork no longer uses the operation', () => {
    const seed = {
      kind: 'edit',
      owner: 'editor',
      serial: 1,
      objectIds: ['heart'],
      operationIds: ['engrave'],
    } as const;
    const moved = [artwork('heart', 'engrave-2', 0)];
    expect(pulseTargetFor(moved, [engrave, sameEngrave], 'laser', seed, centre)).toBeNull();
  });
});

describe('when a hover pulses', () => {
  const edit = {
    kind: 'edit',
    owner: 'editor',
    serial: 1,
    objectIds: ['heart'],
    operationIds: ['engrave'],
  } as const;
  const sceneA = {};
  const sceneB = {};

  it('pulses when an edit begins and again with each change it makes', () => {
    const trigger = new PulseTrigger();
    expect(trigger.next(edit, null, sceneA)).toBe(true);
    expect(trigger.next(edit, null, sceneB)).toBe(true);
    expect(trigger.next(edit, null, sceneB)).toBe(false);
  });

  it('brings an edit back after a hover without pulsing, and pulses the next edit', () => {
    const trigger = new PulseTrigger();
    expect(trigger.next(edit, null, sceneA)).toBe(true);
    expect(trigger.next({ kind: 'object', objectId: 'box' }, 'box', sceneA)).toBe(true);
    expect(trigger.next(edit, null, sceneA)).toBe(false);
    trigger.next(null, null, sceneA);
    expect(trigger.next(edit, null, sceneA)).toBe(true);
  });

  it('pulses an edit that ended and began again while a hover hid it', () => {
    const trigger = new PulseTrigger();
    expect(trigger.next(edit, null, sceneA)).toBe(true);
    expect(trigger.next({ kind: 'operation', operationId: 'engrave' }, null, sceneA)).toBe(true);
    // Under the hover the edit ended and began again: the store made a new edit.
    expect(trigger.next({ ...edit, serial: 2 }, null, sceneA)).toBe(true);
  });

  it('pulses when focus moves straight to another editor of the same artwork', () => {
    const trigger = new PulseTrigger();
    expect(trigger.next(edit, null, sceneA)).toBe(true);
    expect(trigger.next({ ...edit, owner: 'operation-row:engrave' }, null, sceneA)).toBe(true);
    expect(trigger.next({ ...edit, owner: 'operation-row:engrave' }, null, sceneA)).toBe(false);
  });

  it('still regroups a row hover without pulsing when the scene changes under it', () => {
    const trigger = new PulseTrigger();
    const row = { kind: 'operation', operationId: 'engrave' } as const;
    expect(trigger.next(row, null, sceneA)).toBe(true);
    expect(trigger.next(row, null, sceneB)).toBe(false);
  });

  it('returns a paused canvas hover to the same piece without a second pulse', () => {
    const trigger = new PulseTrigger();
    const piece = { kind: 'object', objectId: 'heart' } as const;
    expect(trigger.next(piece, 'heart', sceneA)).toBe(true);
    trigger.next(null, 'heart', sceneA);
    expect(trigger.next(piece, 'heart', sceneA)).toBe(false);
  });
});

describe('pulse clock', () => {
  const target: PulseTarget = {
    colorSources: new Map([['engrave', 'engrave']]),
    objectIds: ['heart'],
    offsets: new Map([['heart', 0]]),
  };

  it('plays one pulse per hover and keeps a soft edge while the pointer stays', () => {
    const clock = new ArtworkPulseClock();
    clock.hover(target, 0);
    expect(clock.frame(0, false).busy).toBe(true);
    expect(clock.frame(0.34 * PULSE_DURATION_MS, false).pieces[0]?.strength).toBeCloseTo(
      PULSE_PEAK_STRENGTH,
    );
    // Hovering again mid-pulse does not restart it.
    clock.hover(target, 0.5 * PULSE_DURATION_MS);
    const done = clock.frame(PULSE_DURATION_MS + 1000, false);
    expect(done.pieces[0]).toMatchObject({
      strength: 0,
      glowAlpha: 0,
      edgeAlpha: PULSE_EDGE_ALPHA,
    });
    expect(done.busy).toBe(false);
  });

  it('fades the edge after the pointer leaves, then forgets the piece', () => {
    const clock = new ArtworkPulseClock();
    clock.hover(target, 0);
    clock.frame(0, false);
    clock.frame(PULSE_DURATION_MS + 1000, false);
    clock.leave();
    clock.frame(PULSE_DURATION_MS + 1016, false);
    const fading = clock.frame(PULSE_DURATION_MS + 1032, false);
    expect(fading.pieces[0]?.edgeAlpha).toBeLessThan(PULSE_EDGE_ALPHA);
    expect(fading.busy).toBe(true);
    const gone = clock.frame(PULSE_DURATION_MS + 3000, false);
    expect(gone.pieces).toEqual([]);
    expect(gone.busy).toBe(false);
  });

  it('returns the edge without a second pulse when a click or drag pauses the hover', () => {
    const clock = new ArtworkPulseClock();
    clock.hover(target, 0);
    clock.frame(0, false);
    clock.frame(PULSE_DURATION_MS + 1000, false);
    clock.leave();
    clock.frame(PULSE_DURATION_MS + 1016, false);
    clock.hover(target, PULSE_DURATION_MS + 1100, { pulse: false });
    const resumed = clock.frame(PULSE_DURATION_MS + 1200, false);
    expect(resumed.pieces[0]).toMatchObject({ strength: 0, glowAlpha: 0 });
    expect(resumed.pieces[0]?.edgeAlpha).toBeGreaterThan(0);
  });

  it('shows the colour without motion when reduced motion is preferred', () => {
    const clock = new ArtworkPulseClock();
    clock.hover(target, 0);
    const shown = clock.frame(10, true);
    expect(shown.pieces[0]).toMatchObject({
      strength: PULSE_PEAK_STRENGTH,
      glowAlpha: 0,
      edgeAlpha: PULSE_EDGE_ALPHA,
    });
    expect(shown.busy).toBe(false);
    clock.leave();
    expect(clock.frame(20, true).pieces).toEqual([]);
  });
});
