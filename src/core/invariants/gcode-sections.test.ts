import { describe, expect, it } from 'vitest';
import { splitGcodeLayerSections } from './gcode-sections';

const SAMPLE = [
  'G21',
  'G90',
  'M3 S0',
  '; layer L0 color #ff0000 power 60% speed 1200 mm/min passes 1',
  '; pass 1 of 1',
  'G0 X10.000 Y10.000 S0',
  'G1 X30.000 Y10.000 F1200 S600',
  'M5',
  'M4 S0',
  '; fill layer L1 color #0000ff power 35% speed 3000 mm/min passes 1 overscan 5.000 mm',
  '; pass 1 of 1',
  'G1 X70.000 Y50.000 F3000 S350',
  'M5',
  '; image layer L2 color #808080 power 45%',
  '; 2 × 2 px, 10.000 × 5.000 mm',
  'M4 S0',
  'G1 X105.000 F2500 S450',
  'M5',
  'G0 X0.000 Y0.000 S0',
  '',
].join('\n');

describe('splitGcodeLayerSections', () => {
  it('splits one section per layer header, in program order', () => {
    const sections = splitGcodeLayerSections(SAMPLE);
    expect(sections.map((s) => s.layerId)).toEqual(['L0', 'L1', 'L2']);
  });

  it('excludes the preamble from every section body', () => {
    for (const section of splitGcodeLayerSections(SAMPLE)) {
      expect(section.body).not.toContain('G21');
      expect(section.body).not.toContain('G90');
    }
  });

  it('keeps each section body from its header up to the next header', () => {
    const sections = splitGcodeLayerSections(SAMPLE);
    expect(sections[0]?.body).toContain('G1 X30.000 Y10.000 F1200 S600');
    expect(sections[0]?.body).not.toContain('S350');
    expect(sections[1]?.body).toContain('G1 X70.000 Y50.000 F3000 S350');
    expect(sections[1]?.body).not.toContain('S600');
    expect(sections[1]?.body).not.toContain('S450');
  });

  it('attaches the postamble to the last section (harmless: no G1 lines)', () => {
    const sections = splitGcodeLayerSections(SAMPLE);
    expect(sections[2]?.body).toContain('G0 X0.000 Y0.000 S0');
  });

  it('recognizes offset-fill headers', () => {
    const sections = splitGcodeLayerSections(
      [
        '; offset fill layer OF1 color #000000 power 20% speed 900 mm/min passes 1',
        'G1 X1.000 F900 S200',
      ].join('\n'),
    );
    expect(sections.map((s) => s.layerId)).toEqual(['OF1']);
  });

  it('returns no sections for header-less G-code', () => {
    expect(splitGcodeLayerSections('G21\nG90\nM3 S0\nM5\n')).toEqual([]);
  });
});
