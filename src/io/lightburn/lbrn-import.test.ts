import { describe, expect, it } from 'vitest';
import { importLightBurnProject } from './lbrn-import';

const PROJECT = `<?xml version="1.0"?>
<LightBurnProject AppVersion="1.7.08" FormatVersion="1">
  <CutSetting index="2" type="Cut" speed="10" maxPower="80" numPasses="2" />
  <Shape Type="Group" CutIndex="0"><XForm>2 0 0 2 10 10</XForm><Children>
    <Shape Type="Rect" CutIndex="2" W="10" H="6"><XForm>1 0 0 1 5 5</XForm></Shape>
    <Shape Type="Ellipse" CutIndex="1" Rx="4" Ry="2"><XForm>1 0 0 1 20 10</XForm></Shape>
  </Children></Shape>
  <Shape Type="Path" CutIndex="0"><XForm>1 0 0 1 0 0</XForm>
    <VertList>V0 0c0x1c1x1V10 0c0x10c0y0c1x10c1y0V10 10c0x10c0y10c1x10c1y10</VertList>
    <PrimList>L0 1B1 2</PrimList>
  </Shape>
</LightBurnProject>`;

describe('importLightBurnProject', () => {
  it('imports affine groups, native curves, layers, and source metadata', () => {
    const result = importLightBurnProject(PROJECT, 'sample.lbrn2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report).toMatchObject({
      appVersion: '1.7.08',
      importedObjects: 3,
      importedLayers: 3,
    });
    expect(result.project.scene.objects[0]).toMatchObject({ bounds: { minX: 10, maxX: 30 } });
    expect(result.project.scene.objects[2]).toMatchObject({
      paths: [{ curves: [{ segments: [{ kind: 'line' }, { kind: 'cubic' }] }] }],
    });
    expect(result.project.scene.layers.find((layer) => layer.color === '#ff0000')).toMatchObject({
      speed: 600,
      power: 80,
      passes: 2,
    });
  });

  it('uses a text BackupPath and reports unsupported shapes', () => {
    const xml = `<LightBurnProject><Shape Type="Text" Str="Hi"><BackupPath Type="Path" CutIndex="0"><XForm>1 0 0 1 5 5</XForm><VertList>V0 0c0x1c1x1V5 0c0x1c1x1</VertList><PrimList>L0 1</PrimList></BackupPath></Shape><Shape Type="Image" /></LightBurnProject>`;
    const result = importLightBurnProject(xml, 'text.lbrn2');
    expect(result).toMatchObject({ ok: true, report: { unsupportedShapeTypes: ['Image'] } });
  });

  it('resolves shared VertID and PrimID geometry tables used by LightBurn 2 projects', () => {
    const xml = `<LightBurnProject AppVersion="2.0.05"><Shape Type="Group"><Children>
      <Shape Type="Path" VertID="1" PrimID="7"><VertList>V0 0c0x1c1x1V10 0c0x1c1x1V10 10c0x1c1x1V0 10c0x1c1x1</VertList><PrimList>L0 1L1 2L2 3L3 0</PrimList></Shape>
      <Shape Type="Path" VertID="2" PrimID="7"><VertList>V20 0c0x1c1x1V30 0c0x1c1x1V30 10c0x1c1x1V20 10c0x1c1x1</VertList></Shape>
      <Shape Type="Path" VertID="1" PrimID="7"><XForm>1 0 0 1 40 0</XForm></Shape>
    </Children></Shape></LightBurnProject>`;
    const result = importLightBurnProject(xml, 'shared-tables.lbrn2');
    expect(result).toMatchObject({
      ok: true,
      report: { importedObjects: 3, warnings: [] },
    });
  });

  it.each(['<!DOCTYPE x><LightBurnProject/>', '<!ENTITY x "boom"><LightBurnProject/>'])(
    'rejects active XML declarations',
    (xml) => expect(importLightBurnProject(xml, 'unsafe.lbrn2')).toMatchObject({ ok: false }),
  );
});
