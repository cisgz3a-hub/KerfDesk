import { describe, expect, it } from 'vitest';
import { linesPerMmToLineIntervalMm } from '../../core/raster/raster-units';
import { createLayer, type Layer } from '../../core/scene';
import { dotWidthCorrectionMax, readCutSettingsPatch } from './cut-settings-draft';

describe('cut settings draft helpers', () => {
  it('clamps common power, min power, speed, and pass values', () => {
    const layer = imageLayer({ minPower: 5, power: 30, passes: 1 });
    const patch = readCutSettingsPatch(
      formData({
        mode: 'image',
        power: '42',
        minPower: '99',
        speed: '-50',
        passes: '2.9',
        visible: 'on',
        output: 'on',
      }),
      layer,
    );

    expect(patch.power).toBe(42);
    expect(patch.minPower).toBe(42);
    expect(patch.speed).toBe(1);
    expect(patch.passes).toBe(2);
  });

  it('reads air assist checkbox from the shared cut settings form', () => {
    const layer = createLayer({ id: 'L1', color: '#000000' });
    const patch = readCutSettingsPatch(
      formData({
        mode: 'line',
        power: '30',
        speed: '1500',
        passes: '1',
        visible: 'on',
        output: 'on',
        airAssist: 'on',
      }),
      layer,
    );

    expect(patch.airAssist).toBe(true);
  });

  it('reads and clamps line-mode kerf compensation in millimeters', () => {
    const layer = lineLayer({ kerfOffsetMm: 0.05 });

    expect(
      readCutSettingsPatch(formData({ mode: 'line', kerfOffsetMm: '0.12' }), layer).kerfOffsetMm,
    ).toBe(0.12);
    expect(
      readCutSettingsPatch(formData({ mode: 'line', kerfOffsetMm: '99' }), layer).kerfOffsetMm,
    ).toBe(10);
    expect(
      readCutSettingsPatch(formData({ mode: 'line', kerfOffsetMm: '-99' }), layer).kerfOffsetMm,
    ).toBe(-10);
  });

  it('preserves kerf compensation outside line mode', () => {
    const layer = fillLayer({ kerfOffsetMm: 0.2 });

    expect(
      readCutSettingsPatch(formData({ mode: 'fill', kerfOffsetMm: '0.4' }), layer).kerfOffsetMm,
    ).toBe(0.2);
  });

  it('reads and clamps line-mode tabs / bridges controls', () => {
    const layer = lineLayer({ tabSizeMm: 0.5, tabsPerShape: 4, tabSkipInnerShapes: true });
    const patch = readCutSettingsPatch(
      formData({
        mode: 'line',
        tabsEnabled: 'on',
        tabSizeMm: '0',
        tabsPerShape: '4.9',
      }),
      layer,
    );

    expect(patch.tabsEnabled).toBe(true);
    expect(patch.tabSizeMm).toBe(0.01);
    expect(patch.tabsPerShape).toBe(4);
    expect(patch.tabSkipInnerShapes).toBe(false);
  });

  it('preserves tabs / bridges settings outside line mode', () => {
    const layer = fillLayer({
      tabsEnabled: true,
      tabSizeMm: 1.25,
      tabsPerShape: 6,
      tabSkipInnerShapes: false,
    });

    const patch = readCutSettingsPatch(
      formData({
        mode: 'fill',
        tabsEnabled: '',
        tabSizeMm: '0.01',
        tabsPerShape: '1',
        tabSkipInnerShapes: 'on',
      }),
      layer,
    );

    expect(patch.tabsEnabled).toBe(true);
    expect(patch.tabSizeMm).toBe(1.25);
    expect(patch.tabsPerShape).toBe(6);
    expect(patch.tabSkipInnerShapes).toBe(false);
  });

  it('maps fill line interval and lines-per-inch values to hatch spacing', () => {
    const layer = fillLayer({ hatchSpacingMm: 0.2 });

    expect(
      readCutSettingsPatch(formData({ mode: 'fill', hatchSpacingMm: '0.25' }), layer)
        .hatchSpacingMm,
    ).toBe(0.25);
    expect(
      readCutSettingsPatch(formData({ mode: 'fill', fillLinesPerInch: '254' }), layer)
        .hatchSpacingMm,
    ).toBeCloseTo(0.1, 8);
  });

  it('reads fill style from fill-mode forms', () => {
    const layer = fillLayer();

    expect(
      (
        readCutSettingsPatch(formData({ mode: 'fill', fillStyle: 'offset' }), layer) as {
          readonly fillStyle?: unknown;
        }
      ).fillStyle,
    ).toBe('offset');
    expect(
      (
        readCutSettingsPatch(formData({ mode: 'fill', fillStyle: 'auto' }), layer) as {
          readonly fillStyle?: unknown;
        }
      ).fillStyle,
    ).toBe('scanline');
    expect(
      (
        readCutSettingsPatch(formData({ mode: 'fill', fillStyle: 'spiral' }), layer) as {
          readonly fillStyle?: unknown;
        }
      ).fillStyle,
    ).toBe('scanline');
  });

  it('maps image DPI and line interval values to lines per mm', () => {
    const layer = imageLayer({ linesPerMm: 10 });

    expect(
      readCutSettingsPatch(formData({ mode: 'image', imageDpi: '508' }), layer).linesPerMm,
    ).toBe(20);
    expect(
      readCutSettingsPatch(formData({ mode: 'image', lineIntervalMm: '0.2' }), layer).linesPerMm,
    ).toBe(5);
  });

  it('clamps dot width correction to one raster line interval', () => {
    const layer = imageLayer({ linesPerMm: 10, dotWidthCorrectionMm: 0 });
    const patch = readCutSettingsPatch(
      formData({
        mode: 'image',
        imageDpi: '254',
        dotWidthCorrectionMm: '99',
      }),
      layer,
    );

    expect(dotWidthCorrectionMax(10)).toBe(0.1);
    expect(patch.dotWidthCorrectionMm).toBeCloseTo(linesPerMmToLineIntervalMm(10), 8);
  });

  it('reads image bidirectional scanning only from image-mode forms', () => {
    const layer = imageLayer({ imageBidirectional: true });

    expect(
      readCutSettingsPatch(formData({ mode: 'image', imageBidirectional: 'on' }), layer)
        .imageBidirectional,
    ).toBe(true);
    expect(readCutSettingsPatch(formData({ mode: 'image' }), layer).imageBidirectional).toBe(false);
    expect(
      readCutSettingsPatch(formData({ mode: 'fill' }), { ...layer, imageBidirectional: true })
        .imageBidirectional,
    ).toBe(true);
  });
});

function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function fillLayer(patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: '#ff0000', color: '#ff0000', mode: 'fill' }), ...patch };
}

function lineLayer(patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: '#000000', color: '#000000', mode: 'line' }), ...patch };
}

function imageLayer(patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: '#808080', color: '#808080', mode: 'image' }), ...patch };
}
