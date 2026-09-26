import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import { MAX_FILL_OVERSCAN_MM } from '../../core/job/compile-job-defaults';
import { importLightBurnProject } from './lbrn-import';

// LightBurn exports a boolean overscan switch separately from overscanPercent.
// Field types confirmed by LightBurn staff in forum topic 12911; exported XML
// example: MarcinZukowski/lightburn-tester/examples/example1.lbrn, lines 180-181.
function importScan(fields: string): ReturnType<typeof importLightBurnProject> {
  return importLightBurnProject(
    `<LightBurnProject FormatVersion="1"><CutSetting type="Scan"><index Value="1"/>
      ${fields}</CutSetting><Shape Type="Rect" CutIndex="1" W="10" H="6"/>
    </LightBurnProject>`,
    'scan-overscan.lbrn2',
  );
}

describe('LightBurn exported overscan fields', () => {
  it.each([
    ['100', '5', 5],
    ['15', '2.5', 0.375],
    ['12.5', '2.5', 0.3125],
  ])('converts enabled %s mm/s and %s percent through compilation', (speed, percent, runway) => {
    const result = importScan(
      `<speed Value="${speed}"/><overscan Value="1"/><overscanPercent Value="${percent}"/>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.scene.layers[0]?.fillOverscanMm).toBe(runway);
    expect(compileJob(result.project.scene, result.project.device).groups[0]).toMatchObject({
      kind: 'fill',
      overscanMm: runway,
    });
    expect(result.report.warnings).toEqual([
      expect.stringContaining(`overscan ${percent}% was converted to ${runway} mm`),
    ]);
  });

  // 2026-09-25 PR audit LBG-5: 5 % at 1000 mm/s converted to a 50 mm runway, twice
  // the Overscan field's maximum, so every lead ran 50 mm past the artwork.
  it('stores a converted runway above the Overscan maximum at the maximum', () => {
    const result = importScan(
      '<speed Value="1000"/><overscan Value="1"/><overscanPercent Value="5"/>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.scene.layers[0]?.fillOverscanMm).toBe(MAX_FILL_OVERSCAN_MM);
    expect(result.report.warnings).toEqual([
      expect.stringContaining(
        `converted to 50 mm at 1000 mm/s, above KerfDesk's ${MAX_FILL_OVERSCAN_MM} mm maximum, ` +
          `so it is stored as ${MAX_FILL_OVERSCAN_MM} mm`,
      ),
    ]);
  });

  it('preserves disabled overscan as zero even with a retained nonzero percentage', () => {
    const result = importScan('<overscan Value="0"/><overscanPercent Value="5"/>');
    expect(result).toMatchObject({
      ok: true,
      project: { scene: { layers: [{ fillOverscanMm: 0 }] } },
      report: { warnings: [] },
    });
    if (!result.ok) return;
    // Keep the explicit zero in the compiled group; downstream runway policy
    // remains the existing compiler/emitter's responsibility.
    expect(compileJob(result.project.scene, result.project.device).groups[0]).toMatchObject({
      kind: 'fill',
      overscanMm: 0,
    });
  });

  it.each([
    ['<overscan Value="1"/><speed Value="100"/>', 'percentage'],
    ['<overscan Value="1"/><overscanPercent Value="5"/>', 'speed'],
    ['<overscanPercent Value="5"/><speed Value="100"/>', 'enable'],
    ['<overscan Value="1"/><overscanPercent Value="-5"/><speed Value="100"/>', 'percentage'],
  ])('retains the default and discloses incomplete source fields: %s', (fields, warning) => {
    const result = importScan(fields);
    expect(result).toMatchObject({
      ok: true,
      project: { scene: { layers: [{ fillOverscanMm: 5 }] } },
      report: { warnings: [expect.stringContaining(warning)] },
    });
    if (result.ok) {
      expect(result.report.warnings[0]).toContain('review the default 5 mm runway');
    }
  });

  it('imports enabled zero percentage without requiring a speed', () => {
    expect(importScan('<overscan Value="1"/><overscanPercent Value="0"/>')).toMatchObject({
      ok: true,
      project: { scene: { layers: [{ fillOverscanMm: 0 }] } },
      report: { warnings: [] },
    });
  });

  it('leaves absent overscan fields at the default without warnings', () => {
    expect(importScan('')).toMatchObject({
      ok: true,
      project: { scene: { layers: [{ fillOverscanMm: 5 }] } },
      report: { warnings: [] },
    });
  });
});
