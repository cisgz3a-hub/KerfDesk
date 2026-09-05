import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import { grblStrategy } from '../../core/output';
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

  it('reads cut settings from LightBurn child elements', () => {
    const xml = `<LightBurnProject FormatVersion="1">
      <CutSetting type="Scan">
        <index Value="1"/>
        <maxPower Value="50"/>
        <speed Value="15"/>
        <numPasses Value="3"/>
      </CutSetting>
      <Shape Type="Rect" CutIndex="1" W="10" H="6"><XForm>1 0 0 1 5 5</XForm></Shape>
    </LightBurnProject>`;
    const result = importLightBurnProject(xml, 'child-elements.lbrn2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.scene.layers.find((layer) => layer.color === '#0000ff')).toMatchObject({
      mode: 'fill',
      speed: 900,
      power: 50,
      passes: 3,
    });
  });

  it('preserves Scan fields and converts percentage overscan at the imported speed', () => {
    const xml = `<LightBurnProject FormatVersion="1">
      <CutSetting type="Scan">
        <index Value="1"/><maxPower Value="50"/><speed Value="15"/><numPasses Value="3"/>
        <interval Value="0.08"/><overscan Value="1"/><overscanPercent Value="2"/><angle Value="90"/>
        <crossHatch Value="1"/><bidirectional Value="0"/><minPower Value="12"/>
      </CutSetting>
      <Shape Type="Rect" CutIndex="1" W="10" H="6"><XForm>1 0 0 1 5 5</XForm></Shape>
    </LightBurnProject>`;
    const result = importLightBurnProject(xml, 'scan-fields.lbrn2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.scene.layers[0]).toMatchObject({
      mode: 'fill',
      speed: 900,
      power: 50,
      passes: 3,
      hatchSpacingMm: 0.08,
      hatchAngleDeg: 90,
      fillCrossHatch: true,
      fillBidirectional: false,
      fillOverscanMm: 0.3,
    });
    expect(result.report.warnings).toEqual([
      expect.stringContaining('minimum power'),
      expect.stringContaining('converted to 0.3 mm at 15 mm/s'),
    ]);

    const job = compileJob(result.project.scene, result.project.device);
    const fill = job.groups.find((group) => group.kind === 'fill');
    expect(fill).toMatchObject({ speed: 900, overscanMm: 0.3 });
    if (fill?.kind !== 'fill') throw new Error('expected imported fill group');
    expect(fill.segments.every((segment) => segment.reverse === false)).toBe(true);
    expect(
      fill.segments.some((segment) => {
        const start = segment.polyline[0];
        const end = segment.polyline[1];
        return start !== undefined && end !== undefined && Math.abs(start.x - end.x) < 1e-6;
      }),
    ).toBe(true);
    expect(grblStrategy.emit(job, result.project.device)).toContain('F900');
  });

  it('maps a zero Scan overscan losslessly without a warning', () => {
    const xml = `<LightBurnProject><CutSetting index="1" type="Scan" overscan="0"/><Shape Type="Rect" CutIndex="1" W="10" H="6"/></LightBurnProject>`;
    const result = importLightBurnProject(xml, 'zero-overscan.lbrn2');
    expect(result).toMatchObject({
      ok: true,
      project: { scene: { layers: [{ fillOverscanMm: 0 }] } },
      report: { warnings: [] },
    });
  });

  it('keeps the default runway and warns when percentage overscan lacks a speed', () => {
    const xml = `<LightBurnProject><CutSetting index="1" type="Scan" overscan="1" overscanPercent="5"/><Shape Type="Rect" CutIndex="1" W="10" H="6"/></LightBurnProject>`;
    const result = importLightBurnProject(xml, 'missing-speed.lbrn2');
    expect(result).toMatchObject({
      ok: true,
      project: { scene: { layers: [{ fillOverscanMm: 5 }] } },
      report: { warnings: [expect.stringContaining('could not be converted')] },
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
