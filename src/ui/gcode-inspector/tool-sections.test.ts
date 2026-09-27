import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, SEG_KIND, type GcodeRenderModel } from '../../core/gcode-view';
import { parseToolGeometry, programToolCollector } from './program-tools';
import { buildToolSections, toolAtSegment } from './tool-sections';

// Two operations as KerfDesk's CNC emitter writes them: each opens with its
// tool comments, and the second follows a manual tool-change hold.
const TWO_TOOLS = [
  'G21 G90',
  'G0 Z5',
  '; cnc layer-id: rough',
  '; cnc operation: pocket; passes: 1',
  '; cnc tool-id: em-6350',
  '; cnc tool-name: 6.35 mm end mill',
  '; cnc tool: end-mill; diameter-mm: 6.350',
  'G0 X0 Y0',
  'G1 Z-2 F300',
  'G1 X20 F1200',
  'G0 Z5',
  '; tool change: load 60 deg V-bit',
  'M0',
  '; cnc layer-id: detail',
  '; cnc operation: v-carve; passes: 1',
  '; cnc tool-id: vb-60',
  '; cnc tool-name: 60 deg V-bit',
  '; cnc tool: v-bit; diameter-mm: 12.700; angle-deg: 60.000',
  'G0 X30 Y0',
  'G1 Z-1 F300',
  'G1 X40 F900',
  'G0 Z5',
].join('\n');

function parsed(text: string): { readonly model: GcodeRenderModel; readonly lines: string[] } {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return { model: result.model, lines: text.split('\n') };
}

function marksOf(lines: ReadonlyArray<string>) {
  const collector = programToolCollector();
  for (const line of lines) collector.observe(line);
  return collector.marks;
}

describe('programToolCollector', () => {
  it('reads each operation tool with its id, name, geometry and source line', () => {
    const marks = marksOf(TWO_TOOLS.split('\n'));
    expect(marks).toEqual([
      {
        line: 6,
        key: 'em-6350',
        label: '6.35 mm end mill',
        geometry: { kind: 'end-mill', diameterMm: 6.35 },
        toolId: 'em-6350',
      },
      {
        line: 17,
        key: 'vb-60',
        label: '60 deg V-bit',
        geometry: { kind: 'v-bit', diameterMm: 12.7, tipAngleDeg: 60 },
        toolId: 'vb-60',
      },
    ]);
  });

  it('describes an unnamed tool from its geometry and never carries a name across operations', () => {
    const marks = marksOf([
      '; cnc layer-id: a',
      '; cnc tool-name: Named',
      '; cnc layer-id: b',
      '; cnc tool: ball-nose; diameter-mm: 3.175',
    ]);
    expect(marks[0]?.label).toBe('3.175 mm ball nose');
    expect(marks[0]?.key).toBe('3.175 mm ball nose');
  });

  it('parses optional tip fields and rejects unknown kinds or sizes', () => {
    expect(
      parseToolGeometry(
        '; cnc tool: tapered-ball-nose; diameter-mm: 6.220; angle-deg: 7.840; tip-diameter-mm: 2.000',
      ),
    ).toEqual({ kind: 'tapered-ball-nose', diameterMm: 6.22, tipAngleDeg: 7.84, tipDiameterMm: 2 });
    expect(parseToolGeometry('; cnc tool: drill; diameter-mm: 3')).toBeNull();
    expect(parseToolGeometry('; cnc tool: end-mill; diameter-mm: 0')).toBeNull();
  });
});

describe('buildToolSections', () => {
  it('splits moves at each tool, counting cutting moves only', () => {
    const { model, lines } = parsed(TWO_TOOLS);
    const sections = buildToolSections(model, marksOf(lines));
    expect(sections.tools.map((tool) => tool.label)).toEqual(['6.35 mm end mill', '60 deg V-bit']);
    let cutting = [0, 0];
    for (let index = 0; index < model.segmentCount; index += 1) {
      if (model.segKind[index] === SEG_KIND.travel) continue;
      const tool = sections.segTool[index] ?? 0;
      cutting = cutting.map((count, at) => (at === tool ? count + 1 : count));
    }
    expect(sections.tools.map((tool) => tool.moveCount)).toEqual(cutting);
    // The opening retract runs on the bit loaded before starting: the first one.
    expect(sections.segTool[0]).toBe(0);
    expect(toolAtSegment(sections, model.segmentCount - 1)?.label).toBe('60 deg V-bit');
    expect(toolAtSegment(sections, -1)?.label).toBe('6.35 mm end mill');
  });

  it('merges repeat uses of one tool and falls back to T words, then one toolpath', () => {
    const { model: tWords } = parsed(
      ['T1 M6', 'G1 X10 F500', 'T2 M6', 'G1 X20', 'T1 M6', 'G1 X30'].join('\n'),
    );
    const sections = buildToolSections(tWords, []);
    expect(sections.tools.map((tool) => tool.label)).toEqual(['T1', 'T2']);
    const { model: plain } = parsed('G1 X10 F500\nG1 X20');
    expect(buildToolSections(plain, []).tools).toEqual([
      { label: null, geometry: null, toolId: null, moveCount: 2 },
    ]);
  });
});
