// Which tool each move runs with (ADR-426). KerfDesk's own CNC output names
// each operation's bit in comments (program-tools.ts); other programs change
// tool with T words. The Tool lens colours each tool on its own, and Studio
// draws the bit in use at the playhead.

import { SEG_KIND } from '../../core/gcode-view';
import type { InspectorRenderModel } from './inspector-model';
import type { ProgramToolGeometry, ProgramToolMark } from './program-tools';

export type ProgramTool = {
  /** Null for a program that never names a tool. */
  readonly label: string | null;
  readonly geometry: ProgramToolGeometry | null;
  readonly toolId: string | null;
  /** Cutting moves (everything but travel). */
  readonly moveCount: number;
};

export type ToolSections = {
  /** Index into `tools` for every render-model segment. */
  readonly segTool: Uint16Array;
  /** Distinct tools in order of first use. */
  readonly tools: ReadonlyArray<ProgramTool>;
};

type MutableTool = { -readonly [K in keyof ProgramTool]: ProgramTool[K] };

const NO_TOOL: Omit<ProgramToolMark, 'line'> = {
  key: '',
  label: '',
  geometry: null,
  toolId: null,
};

export function buildToolSections(
  model: InspectorRenderModel,
  marks: ReadonlyArray<ProgramToolMark>,
): ToolSections {
  const boundaries = toolBoundaries(model, marks);
  const segTool = new Uint16Array(model.segmentCount);
  const indexOf = new Map<string, number>();
  const tools: MutableTool[] = [];
  // Moves before the first named tool run on the bit loaded before starting,
  // which is the first one the program names.
  let current: Omit<ProgramToolMark, 'line'> | null = boundaries[0] ?? null;
  let next = 0;
  for (let segment = 0; segment < model.segmentCount; segment += 1) {
    const line = model.segLine[segment] ?? 0;
    while (next < boundaries.length && (boundaries[next]?.line ?? Infinity) <= line) {
      current = boundaries[next] ?? current;
      next += 1;
    }
    const index = toolIndex(indexOf, tools, current);
    segTool[segment] = index;
    const tool = tools[index];
    if (tool !== undefined && model.segKind[segment] !== SEG_KIND.travel) tool.moveCount += 1;
  }
  return { segTool, tools };
}

/** The tool cutting at a segment; the first tool before any segment. */
export function toolAtSegment(sections: ToolSections, segmentIndex: number): ProgramTool | null {
  const index = segmentIndex < 0 ? 0 : (sections.segTool[segmentIndex] ?? 0);
  return sections.tools[index] ?? null;
}

function toolIndex(
  indexOf: Map<string, number>,
  tools: MutableTool[],
  mark: Omit<ProgramToolMark, 'line'> | null,
): number {
  const source = mark ?? NO_TOOL;
  const existing = indexOf.get(source.key);
  if (existing !== undefined) return existing;
  const index = tools.length;
  indexOf.set(source.key, index);
  tools.push({
    label: mark === null ? null : mark.label,
    geometry: source.geometry,
    toolId: source.toolId,
    moveCount: 0,
  });
  return index;
}

// Comment marks and T words, in source order.
function toolBoundaries(
  model: InspectorRenderModel,
  marks: ReadonlyArray<ProgramToolMark>,
): ReadonlyArray<ProgramToolMark> {
  const boundaries: ProgramToolMark[] = [...marks];
  for (const event of model.events) {
    if (event.kind !== 'tool-word') continue;
    const label = `T${event.tool}`;
    boundaries.push({ line: event.line, key: label, label, geometry: null, toolId: null });
  }
  return boundaries.sort((left, right) => left.line - right.line);
}
